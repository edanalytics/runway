# Borrowing from
# https://github.com/edanalytics/startingblocks_seed_data_cloudformation/blob/feature/7.1-emlb/em_lb_docker/Dockerfile

# Use a base image
FROM public.ecr.aws/docker/library/python:3.12-slim-bookworm

# Set the working directory
WORKDIR /executor

# linux dependencies:
RUN apt update && \
    # - git: clones bundle repositories
    apt install -y git

COPY ./ /executor
RUN pip install -r requirements.txt && \
    pip install -e .

RUN git clone https://github.com/edanalytics/earthmover_edfi_bundles.git bundles

RUN useradd -M -s /bin/bash executor && \
    chown -R executor:executor /executor
USER executor

CMD ["python", "-u", "/executor/scripts/main.py"]
