#!/bin/bash

# Check if node version is 22 (expected)
RED="\e[31m"
node_version=$(node -v)
if [[ $node_version != v22* ]]; then
  echo -e "${RED}\nYour current Node version is $node_version. Please install v22.x before continuing.\n"
  exit 1
fi

# Copy environment variable template files
echo "Creating untracked environment variable files."
if [ -f ./fe/.env ] || [-f ./api/.env]; then
  echo -e "\n"
  while true; do
    read -p "You have already created environment variable files. Do you want to overwrite them? (y/n) " yn
    case $yn in
        [Yy]* ) cp ./fe/.env.copyme ./fe/.env && cp ./api/.env.copyme ./api/.env; break;;
        [Nn]* ) echo -e "${RED}\nSkipping env file creation.\n"; break;;
        * ) echo "Please answer yes or no.";;
    esac
  done
else
  cp ./fe/.env.copyme ./fe/.env
  cp ./api/.env.copyme ./api/.env
fi

# Install node dependencies
echo "Installing node dependencies."
npm install --silent

# Generate prisma client (postinstall script can't find schema file not in root)
echo "Generating Prisma client to node_modules."
npm run prisma:generate-client

# Start local dev database in docker
echo "Starting local database in docker."
pushd ./api > /dev/null
docker compose up --detach --quiet-pull
sleep 3
popd > /dev/null

# Run migrations to prep for IdP seeding
echo "Running database migrations."
npm run api:migrate-local-dev

# Set up LOCAL_EXECUTOR=python for ExecutorF
echo "Set up Executor to run locally? This will create a virtual environment in runway/executor/local-run/venv, install dependencies, and clone the bundle repo."
while true; do
  read -p "Do you want to set up Executor to run locally? (y/n) " yn

  if [[ $yn =~ ^[Yy] ]]; then
    mkdir -p ../executor/local-run
    pushd ../executor/local-run > /dev/null
    python3 -m venv venv
    ./venv/bin/pip install -r ../requirements.txt
    ./venv/bin/pip install -e ..
    git clone https://github.com/edanalytics/earthmover_edfi_bundles.git bundles
    popd > /dev/null
    break;
  elif [[ $yn =~ ^[Nn] ]]; then
    echo -e "${RED}\nSkipping Executor setup.\n"; break;
  else
    echo "Please answer yes or no.";
    fi
  done


# Log help info
cat << EOF



Initialized local development environment:
- Copied front-end and server environment variable 'copyme' files.
- Installed node dependencies.
- Generated Prisma ORM database client.
- Started local app database in docker.
- Ran database migrations


You can now connect an IdP (see README).


When ready, start the API and client dev servers:
npx nx run api:serve
npx nx run fe:serve


See ./package.json and the various README files for other instructions
and possible commands.

EOF
