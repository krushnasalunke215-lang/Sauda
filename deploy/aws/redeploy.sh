#!/usr/bin/env bash
# Deploys a commit of Sauda on the AWS Lightsail host (see "Hosting on AWS Lightsail" in the README).
#   sudo sauda-redeploy            deploy origin/main
#   sudo sauda-redeploy <commit>   deploy, or roll back to, another commit
# Each commit is built in its own folder under /opt/sauda/releases while the running version keeps
# serving, so a failed build changes nothing. Then /opt/sauda/current is switched to it, the
# service restarts and the script waits until /healthz reports the new commit.
set -euo pipefail

main() {
  local ref="${1:-origin/main}" base=/opt/sauda
  local repo="$base/repo"
  as_sauda() { sudo -u sauda -H "$@"; }

  if [ ! -d "$repo/.git" ]; then
    as_sauda git clone --quiet https://github.com/krushnasalunke215-lang/Sauda.git "$repo"
  fi
  as_sauda git -C "$repo" fetch --quiet --prune origin
  local commit
  commit=$(as_sauda git -C "$repo" rev-parse --verify "$ref^{commit}")
  local dir="$base/releases/$commit"

  if [ ! -f "$dir/dist/client/build-info.json" ]; then
    echo "building $commit"
    as_sauda rm -rf "$dir"
    as_sauda mkdir -p "$dir"
    as_sauda bash -c 'git -C "$1" archive "$2" | tar -x -C "$3"' _ "$repo" "$commit" "$dir"
    as_sauda bash -c 'cd "$1" && npm ci --no-audit --no-fund && npm run bryntum:install && npm run build' _ "$dir"
  fi
  echo "build-info: $(cat "$dir/dist/client/build-info.json")"

  # The host configuration travels with the code (commits before it was added keep the installed files).
  if [ -d "$dir/deploy/aws" ]; then
    install -m 644 "$dir/deploy/aws/sauda.service" /etc/systemd/system/sauda.service
    install -m 644 "$dir/deploy/aws/Caddyfile" /etc/caddy/Caddyfile
    install -m 755 "$dir/deploy/aws/redeploy.sh" /usr/local/bin/sauda-redeploy
    systemctl daemon-reload
  fi
  systemctl enable --quiet sauda caddy
  systemctl reload-or-restart caddy

  as_sauda ln -sfn "$dir" "$base/current.new"
  as_sauda mv -T "$base/current.new" "$base/current"
  printf 'RENDER_GIT_COMMIT=%s\n' "$commit" > /etc/sauda/commit.env
  systemctl restart sauda

  local health=""
  for _ in $(seq 1 45); do
    sleep 2
    health=$(curl -fsS http://127.0.0.1:8787/healthz 2>/dev/null) || continue
    if [[ "$health" == *"\"commit\":\"$commit\""* ]]; then
      echo "deployed: $health"
      # Keep the deployed folder and the two newest others, for a quick rollback.
      ls -1dt "$base"/releases/*/ | sed 's#/$##' | grep -vx "$dir" | tail -n +3 | xargs -r rm -rf
      return 0
    fi
  done
  echo "/healthz does not report $commit; see: journalctl -u sauda -n 100" >&2
  return 1
}

main "$@"
exit
