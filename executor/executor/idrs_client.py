import json
import logging
import requests
import re
from collections.abc import Iterator
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError
from datetime import datetime
from executor.config import IDRS_BATCH_SIZE

IDRS_CANDIDATE_SCHEMA = {
    "type": "object",
    "properties": {
        "correlation_id": {"type": "string", "minLength": 1},
        "first_name": {"type": ["string", "null"]},
        "last_name": {"type": ["string", "null"]},
        "birth_date": {"type": ["string", "null"], "format": "date"},
        "school_ids": {"type": ["array", "null"], "items": {"type": "integer"}},
        "student_ids": {"type": ["array", "null"], "items": {"type": "string"}},
    },
    "required": ["correlation_id"],
    "additionalProperties": False,
}

IDRS_ALLOWLIST = frozenset(IDRS_CANDIDATE_SCHEMA["properties"].keys())
IDRS_CANDIDATE_VALIDATOR = Draft202012Validator(IDRS_CANDIDATE_SCHEMA, format_checker=Draft202012Validator.FORMAT_CHECKER)

class IDRSClient:

    def __init__(self, logger: logging.Logger, conn: requests.Session, identity_url: str):
        # The logger to use to capture outputs
        self.logger = logger
        # The session to use for handling requests
        self.conn = conn
        # The URL for the IDRS
        self.identity_url = identity_url

    def get_credentials(self) -> dict:
        '''return the IDRS credentials based on matching mode'''
        try:
            idrs_resp = self.conn.get(
                url=self.identity_url
            )   

            idrs_resp.raise_for_status() 
            idrs_conn_info = idrs_resp.json()
            self.logger.info('Received IDRS credentials')

            return idrs_conn_info

        except Exception as e:
            self.logger.error(f'IDRS credentials not returned: {e}')
            raise

    @staticmethod
    def batch_inputs(candidates: list[dict], batch_size: int) -> Iterator[list[dict]]:
        '''batch inputs to an arbitrary size before sending to the IDRS'''   
        for position in range(0, len(candidates), batch_size):
            yield candidates[position:position+batch_size]

    @staticmethod
    def coerce_dates(date: str, fmt: str) -> str | None:
        '''coerce dates to ISO format YYYY-MM-DD. If unable to coerce, fall back to None'''
        try:
            iso_date = datetime.strptime(date, fmt).date().isoformat()
            return iso_date
        except:
            return None

    @staticmethod
    def coerce_student_id(student_id: str) -> str | None:
        '''coerce student id values to str. Otherwise return None.'''
        if isinstance(student_id, str):
            return student_id
        return None

    @staticmethod
    def coerce_school_id(school_id: str) -> int | None:
        '''coerce school id values to int. Otherwise return None.'''
        if isinstance(school_id, int):
            return school_id
        if isinstance(school_id, str) and re.fullmatch(r'[0-9]+', school_id):
            return int(school_id)
        return None
        

    def coerce_candidates(self, candidates: list[dict]) -> list[dict]:
        '''coerce candidates to match IDRS schema expectations'''
        cleaned_candidates = []
        for candidate in candidates:
            new_candidate = {k: v for k,v in candidate.items() if k in IDRS_ALLOWLIST}
            new_candidate['birth_date'] = self.coerce_dates(candidate.get('birth_date'), candidate.get('birth_date_format'))
            new_candidate['school_ids'] = [school_id for school_id in map(self.coerce_school_id, candidate.get('school_ids') or []) if school_id is not None]
            new_candidate['student_ids'] = [student_id for student_id in map(self.coerce_student_id, candidate.get('student_ids') or []) if student_id is not None]
            cleaned_candidates.append(new_candidate)
        return cleaned_candidates

    @staticmethod
    def dedupe_candidates(candidates: list[dict]) -> list[dict]:
        '''drop records with identical correlation_ids'''
        correlation_ids = set()
        deduped_candidates = []
        for candidate in candidates:
            correlation_id = candidate.get('correlation_id')
            if correlation_id not in correlation_ids or correlation_id is None:
                deduped_candidates.append(candidate)
                if correlation_id is not None:
                    correlation_ids.add(correlation_id)

        return deduped_candidates

    def clean_candidates(self, candidates: list[dict]) -> list[dict]:
        '''orchestrate our cleaning helper methods and return a new, cleaned candidates list'''
       
        coerced = self.coerce_candidates(candidates)
        cleaned = self.dedupe_candidates(coerced)

        dedupe_count = len(coerced) - len(cleaned)
        if dedupe_count > 0:
            self.logger.info(f'{dedupe_count} correlation ids were dropped')
        
        return cleaned

    def validate_candidates(self, candidates: list[dict]) -> None:
        '''validate our candidates against the IDRS schema before POSTing'''
        errors=[]
        for index, candidate in enumerate(candidates):
            for error in IDRS_CANDIDATE_VALIDATOR.iter_errors(candidate):
                path = ".".join(str(p) for p in error.absolute_path) or "<record>"
                errors.append(f"[{index}] {path}: failed '{error.validator}'")

        if errors:
            self.logger.error(f"{len(errors)} candidate validations errors. First {min(len(errors), 5)}:")
            for error in errors[:5]:
                self.logger.error(error)
            raise ValidationError(f"{len(errors)} candidates failed validation!")
        else:
            self.logger.info(f"{len(candidates)} were validated!")        
        
    def post_candidates(self, idrs_conn_info: dict, candidates: list[dict]) -> list[dict]:
        '''send candidates to the IDRS'''
        try:
            # Initialize
            matches = []
            sent = 0 
            matched = 0   

            # Chunk out candidates and send to the IDRS
            for batch in self.batch_inputs(candidates, IDRS_BATCH_SIZE):

                resp = self.conn.post(
                    url=idrs_conn_info['url'],
                    headers={"Authorization": f"Bearer {idrs_conn_info['token']}"},
                    json=batch
                ) 

                resp.raise_for_status()

                # Handle matches
                match = resp.json()
                matches.extend(match)

                # Report counts
                sent += len(batch)
                matched += len(match)
                self.logger.info(f'{sent} candidates sent to the IDRS; {matched} matches returned')     
        except Exception as e:
            self.logger.error(f"Candidates not posted: {e}")
            raise

        # Raise an exception if we did not receive any matches.
        if len(matches) == 0:
            self.logger.error("No IDRS Matches returned")
            raise ValueError("No IDRS Matches returned")
                    
        return matches

    def query_idrs(self, candidates_path: str) -> list[dict]:
        '''Get IDRS config, send candidates and return an output set'''

        # load up the candidates
        try:
            with open(candidates_path, 'r') as file:
                candidates = [json.loads(line) for line in file]
        except Exception as e:
            self.logger.error(f"Error reading candidates: {e}")
            raise

        # clean up our candidate inputs
        cleaned_candidates = self.clean_candidates(candidates)

        # validate our candidates
        self.validate_candidates(cleaned_candidates)

        # Capture the credentials
        creds = self.get_credentials()

        # Send the validated candidates and capture the matches
        matches = self.post_candidates(creds, cleaned_candidates)

        return matches