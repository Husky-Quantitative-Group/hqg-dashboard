# GitHub Token Setup Guide

This guide walks you through creating a **GitHub Personal Access Token (fine-grained)** for use with the HQG Dashboard backend.

---

## 🔑 Why You Need This

The HQG Dashboard’s backend may need to fetch private data from GitHub (e.g., strategy repositories under the **Husky-Quantatative-Group** organization).
To authenticate securely, you’ll create a **fine-grained personal access token** and store it locally in your `.env` file.

This guide is meant for people with access to the `hqg-strategies` repository.

---

## 🧭 Step-by-Step Instructions

### 1. Go to the GitHub Token Page

Visit:
👉 [https://github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens)

You’ll see two options:

* **Fine-grained tokens** (recommended)
* **Tokens (classic)**

Choose **Fine-grained personal access tokens**.

---

### 2. Click “Generate New Token”

On the fine-grained tokens page, click **“Generate new token”**.

---

### 3. Name Your Token

Give your token a clear and descriptive name.
For example:

```
{netid} hqg strategies – dev laptop
```

This helps identify where the token is being used.

---

### 4. Choose the Resource Owner

For **Resource owner**, select:

```
Husky-Quantatative-Group
```

This ensures the token is scoped under the HQG GitHub organization instead of your personal account.

---

### 5. Set Repository Access

In the **Repository access** section:

* Choose **Only select repositories**
* From the list, select:

  ```
  Husky-Quantatative-Group/hqg-strategies
  ```

This limits your token’s access to only the necessary repository.

---

### 6. Add Permissions

Click **“Add permission”**.

In the list of available permission groups:

1. Scroll to **Repository permissions**
2. Click **Contents**
3. Set access to **Read-only**

This allows your backend to read repository contents but not make any changes.

TODO JJK: This may be changed to be write access in the future as well.

---

### 7. Generate the Token

Scroll down and click the **“Generate token”** button.

GitHub will now show you your token **once** — copy it immediately.
You will not be able to see it again later.

---

### 8. Add the Token to Your Environment File

Open your backend environment file:

```
backend/.env
```

Add the following line (replace with your actual token):

```ini
GITHUB_TOKEN=ghp_yourGeneratedTokenHere
```

Save the file.

---

### 9. Restart the App

After updating your `.env`, restart your local environment:

```bash
npm run dev
```

Your backend will now use the token when making GitHub API requests.

---

## 🧼 Tips & Security

* Treat this token like a password — **never share or commit it**.
* If it ever leaks, revoke it immediately at
  [https://github.com/settings/tokens](https://github.com/settings/tokens)
* Tokens can expire; you can regenerate a new one anytime.
* Use separate tokens for each device or environment (e.g., “laptop” vs “desktop”).

---

✅ **Done!**
You’ve successfully created and added a GitHub token for HQG Dashboard access.
