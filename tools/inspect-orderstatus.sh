#!/bin/bash
echo "=== db-supabase.js order status methods ==="
grep -n "getOrdersPending\|getOrdersByStatus\|updateOrderStatus\|validateOrder\|status:" /root/var/www/BIPBIPWEB/database/db-supabase.js | head -30
echo ""
echo "=== validate-by-telegram handler (server.js 1593+) ==="
sed -n '1593,1650p' /root/var/www/BIPBIPWEB/server.js
