# environment-migration-test

# Environment Migration Script User Guide

Required input:

* Source Repo Name
* Target Repo Name
* Source Repo Org Name
* Target Repo Org Name
* Personal Access Token For Source (repo, users, and org:admin)
* Personal Access Token For Target (repo, users, and org:admin)

Inputs will be imported as environment variables with the following names:

* SOURCE_REPO
* TARGET_REPO
* SOURCE_ORG
* TARGET_ORG
* GH_PAT_SOURCE
* GH_PAT_TARGET

Once inputs are entered the script will migrate the following settings:

* Secrets (name only, an issue will be opened to list secrets that need to be updated)
* Variables (ame and value)
* Protection rules (except reviewers, an issue will be opened listing reviewers by their login and will need to be added manually)
* Environment Name (optional repo ID tag at the end by changing a boolean in the code)

Script will migrate all environments from a source org to a target org and attempt to migrate most of the settings. Certain features were not
implemented since required reviewers may require org level permissions from a PAT (Personal Access Token that we didn't have access to).