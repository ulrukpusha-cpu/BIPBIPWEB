#!/usr/bin/env bash
# BIPBIPWEB — script Git à lancer depuis la racine du dépôt (machine locale ou VPS).
# Usage : ./git-sync.sh [commande]
#   status   — état du dépôt (défaut)
#   pull     — git pull origin master
#   push     — git push origin master
#   sync     — pull puis push
#   addpush  — ajoute les fichiers suivis modifiés, commit avec message, push (nécessite $2 = message)

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
BRANCH="${GIT_BRANCH:-master}"
REMOTE="${GIT_REMOTE:-origin}"

cmd="${1:-status}"
case "$cmd" in
  status|st)
    git status -sb
    ;;
  pull|pl)
    git pull "$REMOTE" "$BRANCH"
    ;;
  push|ps)
    git push "$REMOTE" "$BRANCH"
    ;;
  sync|sy)
    git pull "$REMOTE" "$BRANCH"
    git push "$REMOTE" "$BRANCH"
    ;;
  addpush|ap)
    if [[ -z "${2:-}" ]]; then
      echo "Usage: $0 addpush \"message de commit\"" >&2
      exit 1
    fi
    git add -u
    git commit -m "$2"
    git push "$REMOTE" "$BRANCH"
    ;;
  *)
    echo "Commande inconnue: $cmd" >&2
    echo "Commandes: status | pull | push | sync | addpush \"message\"" >&2
    exit 1
    ;;
esac
