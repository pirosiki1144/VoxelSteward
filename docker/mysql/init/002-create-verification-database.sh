#!/usr/bin/env bash
set -euo pipefail

# The official MySQL image runs this script only during first initialization
# of an empty data directory. It creates the verification database and user
# without printing any credential or SQL value.

database=${MYSQL_VERIFICATION_DATABASE:-}
user=${MYSQL_VERIFICATION_USER:-}
password=${MYSQL_VERIFICATION_PASSWORD:-}

if [[ -z "$database" && -z "$user" && -z "$password" ]]; then
  exit 0
fi

if [[ -z "$database" || -z "$user" || -z "$password" ]]; then
  echo "verification database configuration is incomplete" >&2
  exit 1
fi

if [[ ! "$database" =~ ^[A-Za-z0-9_]+$ || ! "$user" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "verification database identifiers are invalid" >&2
  exit 1
fi

if [[ "$password" == *$'\n'* || "$password" == *$'\r'* ]]; then
  echo "verification database password contains an unsupported character" >&2
  exit 1
fi

escape_sql_string() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//\'/\'\'}
  printf '%s' "$value"
}

escaped_password=$(escape_sql_string "$password")

mysql --protocol=socket -uroot -p"$MYSQL_ROOT_PASSWORD" --batch --skip-column-names <<SQL
CREATE DATABASE IF NOT EXISTS \`$database\`;
CREATE USER IF NOT EXISTS '$(printf "%s" "$user")'@'%' IDENTIFIED BY '$escaped_password';
GRANT ALL PRIVILEGES ON \`$database\`.* TO '$(printf "%s" "$user")'@'%';
SQL
