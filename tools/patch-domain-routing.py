# -*- coding: utf-8 -*-
# Domaine -> nouveau site : desktop => /site/, mobile/Telegram => app thémée (/app/).
# Réversible : app.html et index.html restent sur le disque.
import io
f = "/root/var/www/BIPBIPWEB/server.js"
s = io.open(f, encoding="utf-8").read()
orig = s

# 1) Mobile/Telegram : app.html -> app/index.html (2 occurrences : route / et route /app)
old_app = "res.sendFile(path.join(__dirname, 'app.html'));"
new_app = "res.sendFile(path.join(__dirname, 'app', 'index.html'));"
n_app = s.count(old_app)
s = s.replace(old_app, new_app)

# 2) Desktop : index.html (Next.js) -> site/index.html
old_idx = "res.sendFile(path.join(__dirname, 'index.html'));"
new_idx = "res.sendFile(path.join(__dirname, 'site', 'index.html'));"
n_idx = s.count(old_idx)
s = s.replace(old_idx, new_idx)

print("app.html remplacé:", n_app, "| index.html remplacé:", n_idx)
if s != orig:
    io.open(f, "w", encoding="utf-8").write(s)
    print("ECRIT")
else:
    print("aucun changement (deja patché ?)")
