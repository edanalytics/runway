import json

class IDRSClient:

    def __init__(self, logger, conn, identity_url):
        # The logger to use to capture outputs
        self.logger=logger
        # The session to use for handling requests
        self.conn=conn
        # The URL for the IDRS
        self.identity_url=identity_url

    def validate_candidates(self, candidates):
        '''method to validate that we are sending data that conforms to IDRS API specs'''
        pass

    def get_credentials(self):
        '''return the IDRS credentials based on matching mode'''
        try:
            idrs_resp = self.conn.get(
                self.identity_url
            )   

            idrs_resp.raise_for_status() 
            idrs_conn_info=idrs_resp.json()
            self.logger.info('Received IDRS credentials')

            return idrs_conn_info

        except Exception as e:
            self.logger.error(f'IDRS credentials not returned: {e}')
            raise

    def post_candidates(self, idrs_conn_info, candidates):
        '''send candidates to the IDRS API'''
        try:
            resp=self.conn.post(
                url=idrs_conn_info['url'],
                headers={"Authorization": f"Bearer {idrs_conn_info['token']}"},
                json=candidates
            ) 

            resp.raise_for_status()
            matches=resp.json()
            self.logger.info('Matches received from IDRS!')

            return matches
        
        except Exception as e:
            self.logger.info(f"Candidates not posted: {e}")
            raise

    def query_idrs(self, candidates_path):
        '''Get IDRS config, send candidates and return an output set'''

        # load up the candidates
        try:
            with open(candidates_path, 'r') as file:
                candidates = [json.loads(line) for line in file]
        except Exception as e:
            self.logger.info(f"Error reading candidates: {e}")
            raise

        # validate our payload
        self.validate_candidates(candidates)

        # Capture the credentials
        creds=self.get_credentials()

        # Send the candidates and capture the matches
        matches=self.post_candidates(creds, candidates)

        return matches