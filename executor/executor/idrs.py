import json
import logging
import re
import requests
import os
from collections.abc import Iterator
from datetime import datetime
from dataclasses import dataclass, field, fields, asdict
from typing import Literal
from executor.config import IDRS_BATCH_SIZE


class IDRSCandidateError(Exception):
    '''error raised when an IDRSCandidate object fails validation'''
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__(f"{len(errors)} candidate errors")


class IDRSClient:
    '''client object that handles interactions with the IDRS (obtaining credentials, posting candidates and returning matches)'''
    def __init__(self, logger: logging.Logger, conn: requests.Session, identity_url: str):
        # The logger to use to capture outputs
        self.logger = logger
        # The session to use for handling requests
        self.conn = conn
        # The URL for the IDRS
        self.identity_url = identity_url

    def get_credentials(self) -> dict:
        '''return credentials used to POST to the IDRS'''
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
                self.logger.info(f'{sent} candidates sent to the IDRS; {matched} results returned')     
        except Exception as e:
            self.logger.error(f"Candidates not posted: {e}")
            raise

        # Raise an exception if we did not receive any matches.
        if len(matches) == 0:
            self.logger.error("No IDRS Matches returned")
            raise ValueError("No IDRS Matches returned")
                    
        return matches

    def query_idrs(self, candidates_path: str) -> list[dict]:
        '''get an IDRS token, send a list of idrs candidates and return the IDRS results list'''
        # Load up our candidates
        idrs_candidates = IDRSCandidate.construct_candidates(candidates_path, self.logger)

        # Capture the credentials
        creds = self.get_credentials()

        # Send off our candidates and capture the matches
        matches = self.post_candidates(creds, idrs_candidates)

        return matches


@dataclass(repr=False)
class IDRSCandidate:
    '''data structure that constructs and validates an IDRSCandidate record from inputs. coercion/validation based on IDRS API spec'''
    correlation_id: str
    first_name: str | None
    last_name: str | None
    birth_date: str | None
    school_ids: list[int] = field(default_factory=list)
    student_ids: list[str] = field(default_factory=list)

    # Validation
    def __post_init__(self):
        '''validate immediately after an IDRSCandidate object is created'''
        errors = []
        if not isinstance(self.correlation_id, str) or not self.correlation_id:
            errors.append('correlation_id must be a non-empty string!')
            raise IDRSCandidateError(errors)

    @classmethod
    def construct_candidates(cls, candidates_path: str, logger: logging.Logger) -> list['IDRSCandidate']:
        '''construct IDRSCandidate objects from an input candidates.jsonl file'''
        # Initialize candidates list
        idrs_candidates, errors = [], []
    
        # Load up candidates from our input path
        with open(candidates_path, 'r') as candidates:
            for index, record in enumerate(candidates):
                try:
                    candidate = cls.coerce_candidate(json.loads(record))
                    idrs_candidates.append(candidate)
                except IDRSCandidateError as e:
                    errors.extend(f"[{index}] {error}" for error in e.errors)

        # raise if we have errors
        if errors:
            logger.error(f"{len(errors)} candidate input errors. First {min(len(errors), 5)}:")
            for error in errors[:5]:
                logger.error(error)
            raise ValueError(f"{len(errors)} candidate input errors")

        # Dedupe candidates
        deduped = cls.dedupe_candidates(idrs_candidates)

        # Log success and return candidates
        logger.info(f"{len(deduped)} candidates validated! {len(idrs_candidates) - len(deduped)} duplicate records were removed")
        return deduped
    
    # Coercion
    @classmethod
    def coerce_candidate(cls, candidate: dict) -> 'IDRSCandidate':
        '''coerce raw candidate record inputs to match the spec of the IDRS schema'''
        # Get a dict subset to only the defined fields of the dataclass
        values = {f.name: candidate.get(f.name) for f in fields(cls)}

        # Coerce as needed
        values['first_name'], values['last_name'] = cls.coerce_names(candidate)
        values['birth_date'] = cls.coerce_date(candidate.get('birth_date'), candidate.get('birth_date_format'))
        values['school_ids'] = list(filter(None, map(cls.coerce_school_id, candidate.get('school_ids', []))))
        values['student_ids'] = list(filter(None, map(cls.coerce_student_id, candidate.get('student_ids', []))))
        
        return cls(**values)
    
    @staticmethod
    def coerce_date(date: str | None, fmt: str | None) -> str | None:
        '''coerce dates to ISO format YYYY-MM-DD. If unable to coerce, fall back to None'''
        try:
            iso_date = datetime.strptime(date, fmt).date().isoformat()
            return iso_date
        except (TypeError, ValueError):
            return None

    @staticmethod
    def coerce_student_id(student_id: object) -> str | None:
        '''coerce student id values to str. Otherwise return None.'''
        if not student_id:
            return None
        return str(student_id)

    @staticmethod
    def coerce_names(candidate: dict) -> tuple[str | None, str | None]:
        '''coerce names with structured rules depending on names sent.
        Tries some common scenarios to split full name, if provided.
        Full name is mutually exclusive with first and last, so if there is no full name, just send the first and last.'''
        first_name, last_name = candidate.get('first_name'), candidate.get('last_name')
        full_name = candidate.get('full_name')
        if first_name or last_name or not isinstance(full_name, str) or not full_name.strip():
            return first_name, last_name
        if "," in full_name:
            last, rest = full_name.split(",", 1)
            given = rest.split()
            return (given[0] if given else None), (last.strip() or None)
        name_parts = full_name.split()
        first_name = name_parts[0]
        last_name = name_parts[-1]
        return first_name, last_name

    @staticmethod
    def coerce_school_id(school_id: object) -> int | None:
        '''coerce school id values to int. Otherwise return None.'''
        if isinstance(school_id, int):
            return school_id
        if isinstance(school_id, str) and re.fullmatch(r'[0-9]+', school_id):
            return int(school_id)
        return None

    # Cleaning
    @classmethod
    def dedupe_candidates(cls, candidates: list['IDRSCandidate']) -> list['IDRSCandidate']:
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
        '''return an IDRSCandidate object as a dictionary'''
        return asdict(self)


@dataclass(frozen=True, repr=False)
class IDRSMatchResult:
    '''data structure that constructs a match result from candidate and match inputs.'''
    correlation_id: str
    candidate: dict
    matches: list[dict]
    match_type: Literal['auto', 'user_input', 'none']

    @classmethod
    def build_match_result(cls, match_result: dict, candidate: dict, match_thresholds: dict[str, float]) -> 'IDRSMatchResult':
        '''build an IDRSMatchResult record with a correlation_id, matches, candidates and a match_type designation'''

        match_scores = [match['score'] for match in match_result['matches']]

        # If we have no match results that clear our no match threshold
        if not any(score >= match_thresholds['NO_MATCH_THRESHOLD'] for score in match_scores):
            match_type = 'none'
        # Auto match if we only have 1 score above our high confidence threshold
        elif ((sum(1 for score in match_scores if score >= match_thresholds['HIGH_CONFIDENCE_MATCH_THRESHOLD']) == 1) and (sum(1 for score in match_scores if score > match_thresholds['SECONDARY_LOW_CONFIDENCE_MATCH_THRESHOLD']) == 1)) :
            match_type = 'auto'
        # Mark for user review if all our scores are below the high confidence threshold or at least 2 exceed the secondary low confidence threshold
        else:
            match_type = 'user_input'

        return cls(
            correlation_id=match_result['correlation_id'], 
            candidate=candidate,
            matches=match_result['matches'],
            match_type=match_type)
        

    # Return
    def to_dict(self) -> dict:
        '''return an IDRSMatchResult object as a dictionary'''
        return asdict(self)


@dataclass(frozen=True, repr=False)
class IDRSMatchResultSet:
    '''data structure that constructs an IDRSMatchResultSet, which can generate id lookups for substitution of auto-matched candidates, as well as candidate sets that need additional review'''
    records: dict[str, 'IDRSMatchResult']

    @classmethod
    def construct_match_result_set(cls, candidates_path: str, matches_path: str, match_thresholds: dict[str, float], logger: logging.Logger) -> 'IDRSMatchResultSet':
        '''given matches and candidates file paths, return a set of IDRSMatchResult objects'''   
        try:    
            candidates = IDRSCandidate.construct_candidates(candidates_path, logger)
            with open(matches_path, 'r') as file:
                matches = json.load(file)

            # Construct our candidates lookup with correlation_id as our join key
            candidates_lookup = {cand.correlation_id: cand for cand in candidates}     

            records = {}
            for match in matches:
                records[match['correlation_id']] = IDRSMatchResult.build_match_result(
                    match, candidates_lookup[match['correlation_id']].to_dict(), match_thresholds
                )
                

            logger.info("Match results constructed!")
            return cls(records=records)
        
        except Exception as e:
            logger.error(f"Issue constructing match results: {e}")
            raise  

    def auto_matched(self) -> dict[str, dict]:
        '''return a correlation_id <-> student_unique_id lookup for auto-matched records'''
        current_year = int(os.environ['API_YEAR'])
        auto_matches = {record.correlation_id: {"student_unique_id": max(record.matches, key=lambda m: m['score'])['student_unique_id'], "cross_year_flag": current_year not in (max(record.matches, key=lambda m: m['score']).get('school_years') or [])} for record in self.records.values() if record.match_type == 'auto'}
        return auto_matches    

    def needs_review(self) -> list[dict]:
        '''return a subset of the IDRSMatchResultSet containing records that need review (user input or 'none')'''
        needs_review = [
            {'correlation_id': record.correlation_id, 'candidate': record.candidate, 'matches': record.matches}
            for record in self.records.values() if record.match_type != 'auto']
        return needs_review    
    
    def to_list(self) -> list[dict]:
        '''return the IDRSMatchResultSet as a list of dictionaries'''
        return [record.to_dict() for record in self.records.values()]