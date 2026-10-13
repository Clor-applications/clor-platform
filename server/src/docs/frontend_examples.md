Frontend examples for authentication and company/branch context

1) Signup

POST /api/auth/signup

Body:
{
  "email": "alice@example.com",
  "password": "secureP@ssw0rd",
  "name": "Alice"
}

Response: { token, user }

Example fetch:

```javascript
const res = await fetch('/api/auth/signup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, name }),
});
const data = await res.json();
localStorage.setItem('token', data.token);
```

2) Login

POST /api/auth/login { email, password }

Save `token` and include on subsequent requests as header:

```
Authorization: Bearer <token>
X-Company-Id: <companyId>    // to select active company context
X-Branch-Id: <branchId>      // optional branch
```

3) Create Company (system admin only)

POST /api/companies/
Headers: `Authorization: Bearer <token>`
Body: { name, description }

4) Create Branch (company admin only)

POST /api/branches/
Headers: `Authorization: Bearer <token>`, `X-Company-Id: <companyId>`
Body: { companyId, name, address }

5) Assign user to company (company admin)

POST /api/users/assign-company
Headers: `Authorization: Bearer <token>`, `X-Company-Id: <companyId>`
Body: { userId, companyId, roleKey }

6) Assign user to branch (company admin)

POST /api/users/assign-branch
Headers: `Authorization: Bearer <token>`, `X-Company-Id: <companyId>`
Body: { userId, branchId }

7) Switching company/branch in UI
- Maintain user's active companyId/branchId in local app state.
- On each request include `X-Company-Id` and `X-Branch-Id` headers.

Security notes
- Never rely on client to enforce company selection; server checks `X-Company-Id` and user access every request.
- Protect all accounting endpoints with `authenticateJWT` and `requireCompanyContext` middleware.
