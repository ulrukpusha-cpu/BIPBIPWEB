#!/bin/bash
echo "=== getOrdersPending / getOrdersByStatus / validate-by-telegram ==="
grep -nE "getOrdersPending|getOrdersByStatus|validate-by-telegram|status.*validated|status.*valide|order.status" /root/var/www/BIPBIPWEB/server.js | head -25
echo ""
echo "=== orderStorage methods ==="
F=$(grep -rl "getOrdersPending" /root/var/www/BIPBIPWEB/services/ 2>/dev/null | head -1)
echo "File: $F"
grep -nE "getOrdersPending|getOrdersByStatus|function|status" "$F" 2>/dev/null | head -30
