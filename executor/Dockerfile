# Borrowing from
# https://github.com/edanalytics/startingblocks_seed_data_cloudformation/blob/feature/7.1-emlb/em_lb_docker/Dockerfile

# Use a base image
FROM public.ecr.aws/docker/library/python:3.12-slim-bookworm

RUN useradd -M -s /bin/bash executor && \
    mkdir -p /executor && chown executor:executor /executor

# Set the working directory
WORKDIR /executor

# linux dependencies:
RUN apt update && \
    # - git: clones bundle repositories
    apt install -y git

COPY --chown=executor:executor requirements.txt /executor/
RUN pip install -r requirements.txt

COPY --chown=executor:executor ./ /executor
RUN pip install -e .

USER executor

RUN git clone https://github.com/edanalytics/earthmover_edfi_bundles.git bundles

CMD ["python", "-u", "/executor/scripts/main.py"]
