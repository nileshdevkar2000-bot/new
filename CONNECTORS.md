# NEO Enterprise AI Connectors

NEO keeps enterprise credentials on the server. Browser code never receives connector tokens.

Supported search adapters:

- Google Drive
- Microsoft 365 / SharePoint via Microsoft Graph
- Salesforce
- Slack
- ServiceNow
- Jira
- Confluence

## Server configuration

Configure only the systems NEO is authorized to search. Examples are in `.env.production.example`.

Use `NEO_CONNECTOR_SCOPES` to restrict connectors to selected NEO roles or departments. Example:

```env
NEO_CONNECTOR_SCOPES={"googleDrive":["SYSTEM_ADMIN","QA"],"salesforce":["SYSTEM_ADMIN","Medical Affairs"]}
```

The System Administrator-only **Enterprise Connectors** page shows connection status and lets the administrator run a server-side retrieval test.

## OAuth readiness

The release contains OAuth client configuration placeholders for Google, Microsoft, Salesforce, Atlassian and Slack. Actual authorization/refresh-token storage should be completed with the organization's approved identity/security service before production rollout. The current server adapters also support direct service/application tokens for controlled deployments.

## Retrieval design

NEO searches permission-scoped internal knowledge first, then optionally runs enterprise and Google retrieval in parallel. Results are bounded by a fast retrieval timeout and passed to the NEO answer engine with the authenticated role/department scope.
