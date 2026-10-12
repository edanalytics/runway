import json
import logging
import requests
import re
from collections.abc import Iterator
from datetime import datetime
from executor.config import IDRS_BATCH_SIZE
from dataclasses import dataclass, field, fields, asdict


class IDRSCandidateError(Exception):
    '''error raised when an issue is encountered with an IDRSCandidate object'''
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__(f"{len(errors)} candidate errors")


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
    def batch_inputs(candidates: list['IDRSCandidate'], batch_size: int) -> Iterator[list['IDRSCandidate']]:
        '''batch inputs to an arbitrary size before sending to the IDRS'''   
        for position in range(0, len(candidates), batch_size):
            yield candidates[position:position+batch_size]    
        
    def post_candidates(self, idrs_conn_info: dict, candidates: list['IDRSCandidate']) -> list[dict]:
        '''send candidates to the IDRS'''
        try:
            # Initialize
            matches = []
            sent = 0 
            matched = 0   

            # Chunk out candidates and send to the IDRS
            for batch in self.batch_inputs(candidates, IDRS_BATCH_SIZE):

                dict_batch = [c.to_dict() for c in batch]

                resp = self.conn.post(
                    url=idrs_conn_info['url'],
                    headers={"Authorization": f"Bearer {idrs_conn_info['token']}"},
                    json=dict_batch
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
        '''Get IDRS token, send a list of idrs candidates and return an output set'''

        # Load up our candidates
        idrs_candidates = IDRSCandidate.construct_candidates(candidates_path, self.logger)

        # Capture the credentials
        creds = self.get_credentials()

        # Send off our candidates and capture the matches
        matches = self.post_candidates(creds, idrs_candidates)

        return matches


@dataclass(repr=False)
class IDRSCandidate:

    correlation_id: str
    first_name: str | None
    last_name: str | None
    birth_date: str | None
    school_ids: list[int] = field(default_factory=list)
    student_ids: list[str] = field(default_factory=list)

    @classmethod
    def construct_candidates(cls, candidates_path: str, logger: logging.Logger) -> list['IDRSCandidate']:
        '''constructs IDRSCandidate objects from an input candidates.jsonl file'''

        # Initialize candidates list
        idrs_candidates, errors = [], []
    
        # Load up candidates from our input path
        with open(candidates_path, 'r') as candidates:
            for index, record in enumerate(candidates):
                try:
                    idrs_candidates.append(cls.coerce_candidate(json.loads(record)))
                except IDRSCandidateError as e:
                    errors.extend(f"[{index}] {error}" for error in e.errors)

        # raise if we have errors
        if errors:
            logger.error(f"{len(errors)} candidate input errors. First {min(len(errors), 5)}:")
            for error in errors[:5]:
                logger.error(f"{error}")
            raise ValueError(f"{len(errors)} candidate input errors")

        # Dedupe candidates
        deduped = cls.dedupe_candidates(idrs_candidates)

        # Log success and return candidates
        logger.info(f"{len(deduped)} candidates validated! {len(idrs_candidates) - len(deduped)} candidate records were dropped")
        return deduped
    
    # Coercion
    @classmethod
    def coerce_candidate(cls, candidate: dict) -> 'IDRSCandidate':
        '''coerce raw candidate record inputs to match the spec of the IDRS schema'''

        # Get a dict subset to only the defined fields of the dataclass
        values = {f.name: candidate.get(f.name) for f in fields(cls)}

        # Coerce as needed
        values['birth_date'] = cls.coerce_date(candidate.get('birth_date'), candidate.get('birth_date_format'))
        values['school_ids'] = [school_id for school_id in map(cls.coerce_school_id, candidate.get('school_ids') or []) if school_id is not None]
        values['student_ids'] = [student_id for student_id in map(cls.coerce_student_id, candidate.get('student_ids') or []) if student_id is not None]
        
        return cls(**values)
    
    @staticmethod
    def coerce_date(date, fmt: str) -> str | None:
        '''coerce dates to ISO format YYYY-MM-DD. If unable to coerce, fall back to None'''
        try:
            iso_date = datetime.strptime(date, fmt).date().isoformat()
            return iso_date
        except (TypeError, ValueError):
            return None

    @staticmethod
    def coerce_student_id(student_id: str) -> str | None:
        '''coerce student id values to str. Otherwise return None.'''
        if isinstance(student_id, int):
            return str(student_id)
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

    # Cleaning
    @staticmethod
    def dedupe_candidates(candidates: list['IDRSCandidate']) -> list['IDRSCandidate']:
        '''drop duplicate records on correlation_id'''

        correlation_ids = set()
        deduped_candidates = []
        for candidate in candidates:
            correlation_id = candidate.correlation_id
            if correlation_id not in correlation_ids:
                correlation_ids.add(correlation_id)
                deduped_candidates.append(candidate)

        return deduped_candidates

    # Return
    def to_dict(self) -> dict:
        return asdict(self)

    # Validation
    def __post_init__(self):
        errors = []
        if not isinstance(self.correlation_id, str) or not self.correlation_id:
            errors.append('correlation_id must be a non-empty string!')
        if errors:
            raise IDRSCandidateError(errors)
    