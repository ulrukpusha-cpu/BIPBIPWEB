#!/bin/bash
KEY="UQAuGWDe9CJqctQnKtNc5jd1MTYpIhas8qQLavQL33tU9wxRAsso"
echo "=== Commandes 'en attente' (getOrdersPending) vues par l'admin ==="
curl -s "https://bipbiprecharge.ci/api/admin/orders" -H "X-Admin-Key: $KEY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
orders = d.get('orders', [])
print('Total pending list:', len(orders))
from collections import Counter
c = Counter(o.get('status') for o in orders)
print('Statuts:', dict(c))
for o in orders[:6]:
    print(' -', o.get('id'), '|', o.get('operator'), o.get('amount'), '| status=', o.get('status'), '| proof=', bool(o.get('proof')), '| pm=', o.get('paymentMethod') or o.get('payment_method'))
"
echo ""
echo "=== Validées ==="
curl -s "https://bipbiprecharge.ci/api/admin/orders?status=validated" -H "X-Admin-Key: $KEY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('Total validated:', len(d.get('orders', [])))
"
