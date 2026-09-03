#!/bin/bash
set -e
BASE="http://localhost:4000/api"
echo "=== 1. Signup Tenant A (a lighting rep firm) ==="
A=$(curl -s -X POST $BASE/auth/signup -H "Content-Type: application/json" -d '{
  "companyName":"Bright Path Lighting Reps","name":"Dana Reyes","email":"dana@brightpath.com","password":"pass1234"
}')
echo "$A" | python3 -m json.tool
TOKEN_A=$(echo "$A" | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
TENANT_A=$(echo "$A" | python3 -c "import json,sys;print(json.load(sys.stdin)['tenant']['id'])")

echo -e "\n=== 2. Signup Tenant B (a plumbing supply rep firm) — total stranger to Tenant A ==="
B=$(curl -s -X POST $BASE/auth/signup -H "Content-Type: application/json" -d '{
  "companyName":"FlowTech Plumbing Reps","name":"Marcus Lee","email":"marcus@flowtech.com","password":"pass1234"
}')
TOKEN_B=$(echo "$B" | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
echo "Tenant B created: $(echo $B | python3 -c "import json,sys;print(json.load(sys.stdin)['tenant']['name'])")"

echo -e "\n=== 3. Tenant A creates a CUSTOM vertical (not in AIT's hardcoded 12) ==="
V=$(curl -s -X POST $BASE/verticals -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" -d '{
  "label":"Municipal Lighting Boards","categoryCode":"MUNI","batchSize":3,"confirmThreshold":0.8
}')
echo "$V" | python3 -m json.tool
VERTICAL_ID=$(echo "$V" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")

echo -e "\n=== 4. Tenant A adds 3 contacts to fill the tiny test batch (batchSize=3) ==="
for i in 1 2 3; do
  curl -s -X POST $BASE/contacts -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" -d "{
    \"verticalId\":\"$VERTICAL_ID\",\"name\":\"Township Board $i\",\"address\":\"$i Main St\",\"tier\":\"A\"
  }" | python3 -c "import json,sys;d=json.load(sys.stdin);print('Created:', d.get('name'), '-> categoryId:', d.get('categoryId'))"
done

echo -e "\n=== 5. Try adding a 4th BEFORE confirming any — should be LOCKED (80% rule) ==="
curl -s -X POST $BASE/contacts -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" -d "{
  \"verticalId\":\"$VERTICAL_ID\",\"name\":\"Township Board 4\",\"tier\":\"A\"
}" | python3 -m json.tool

echo -e "\n=== 6. Confirm 3 of 3 (100% >= 80% threshold) then retry adding — should now unlock batch 2 ==="
CONTACTS=$(curl -s "$BASE/contacts?verticalId=$VERTICAL_ID" -H "Authorization: Bearer $TOKEN_A")
IDS=$(echo "$CONTACTS" | python3 -c "import json,sys;print('\n'.join(c['id'] for c in json.load(sys.stdin)))")
for id in $IDS; do
  curl -s -X PATCH $BASE/contacts/$id -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" -d '{"confirm":true}' > /dev/null
done
curl -s -X POST $BASE/contacts -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" -d "{
  \"verticalId\":\"$VERTICAL_ID\",\"name\":\"Township Board 4\",\"tier\":\"A\"
}" | python3 -c "import json,sys;d=json.load(sys.stdin);print('Created:', d.get('name'), '-> categoryId:', d.get('categoryId'), '(should be MUNI-B2)')"

echo -e "\n=== 7. TENANT ISOLATION CHECK: Tenant B queries contacts — must see ZERO of Tenant A's data ==="
curl -s "$BASE/contacts" -H "Authorization: Bearer $TOKEN_B" | python3 -c "import json,sys;d=json.load(sys.stdin);print('Tenant B sees', len(d), 'contacts (expect 0)')"

echo -e "\n=== 8. Log a call against one of Tenant A's contacts (real durable Call Log table) ==="
FIRST_ID=$(echo "$IDS" | head -1)
curl -s -X POST $BASE/call-logs -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" -d "{
  \"contactId\":\"$FIRST_ID\",\"outcome\":\"positive\",\"notes\":\"Great intro call, wants a follow-up demo\"
}" | python3 -m json.tool

echo -e "\n=== 9. Create + complete a VA task (real durable VA Task Queue table) ==="
TASK=$(curl -s -X POST $BASE/va-tasks -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" -d "{
  \"contactId\":\"$FIRST_ID\",\"missingField\":\"phone\"
}")
TASK_ID=$(echo "$TASK" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
curl -s -X PATCH $BASE/va-tasks/$TASK_ID/complete -H "Authorization: Bearer $TOKEN_A" | python3 -m json.tool

echo -e "\n=== 10. Billing status (trial countdown) ==="
curl -s $BASE/billing/status -H "Authorization: Bearer $TOKEN_A" | python3 -m json.tool

echo -e "\n=== 11. Billing checkout attempt (expected to fail gracefully — placeholder Stripe keys) ==="
curl -s -X POST $BASE/billing/checkout -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" -d '{"plan":"starter"}' | python3 -m json.tool

echo -e "\n✅ ALL TESTS COMPLETE"
