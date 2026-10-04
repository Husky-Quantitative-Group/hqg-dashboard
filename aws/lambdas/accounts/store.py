"""One DynamoDB table where each accepted change is a conditional transaction."""

import json
from control import Conflict


class DynamoStore:
    def __init__(self, client, table):
        self.client, self.table = client, table

    def key(self, account_id, record):
        return {"account_id": {"S": account_id}, "record": {"S": record}}

    def get(self, account_id, record):
        item = self.client.get_item(
            TableName=self.table, Key=self.key(account_id, record), ConsistentRead=True
        ).get("Item")

        return json.loads(item["body"]["S"]) if item else None

    def commit(self, account_id, generation, state, extra):
        writes = []

        for record, body in {"state": state, **extra}.items():
            put = {
                "TableName": self.table,
                "Item": {
                    **self.key(account_id, record),
                    "body": {"S": json.dumps(body, allow_nan=False)},
                },
            }

            if record == "state":
                put["Item"]["generation"] = {"N": str(state["generation"])}
                put.update(
                    ConditionExpression="generation = :old",
                    ExpressionAttributeValues={":old": {"N": str(generation)}},
                )

            else:
                put["ConditionExpression"] = "attribute_not_exists(account_id)"

            writes.append({"Put": put})

        try:
            self.client.transact_write_items(TransactItems=writes)
        except self.client.exceptions.TransactionCanceledException as exc:
            raise Conflict("Concurrent account update") from exc
