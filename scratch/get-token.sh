#!/usr/bin/env bash
# Throwaway dev helper: log in via Cognito and print a fresh IdToken.
# Usage: ./get-token.sh <email> <password>
set -euo pipefail

EMAIL="${1:?usage: get-token.sh <email> <password>}"
PASSWORD="${2:?usage: get-token.sh <email> <password>}"

REGION="us-east-1"
CLIENT_ID="7ca0ana35j1712lp4ssj7ape53"

curl -s "https://cognito-idp.${REGION}.amazonaws.com/" \
  -H "Content-Type: application/x-amz-json-1.1" \
  -H "X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth" \
  -d "{
    \"ClientId\": \"${CLIENT_ID}\",
    \"AuthFlow\": \"USER_PASSWORD_AUTH\",
    \"AuthParameters\": {
      \"USERNAME\": \"${EMAIL}\",
      \"PASSWORD\": \"${PASSWORD}\"
    }
  }" | python3 -c "import sys, json; print(json.load(sys.stdin)['AuthenticationResult']['IdToken'])"
