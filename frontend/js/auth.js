const Auth = (() => {
  const STORAGE = {
    TOKEN: "occ_access_token",
    EXPIRY: "occ_token_expires_at",
    ROLE: "occ_role",
    EMAIL: "occ_user_email",
  };

  const SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
  ].join(" ");

  const LOGIN_URL = "/index.html";
  const DASHBOARD_URL = "/frontend/dashboard.html";

  let tokenClient = null;

  function saveSession(token, expiresIn) {
    sessionStorage.setItem(STORAGE.TOKEN, token);
    sessionStorage.setItem(
      STORAGE.EXPIRY,
      String(Date.now() + expiresIn * 1000)
    );
  }

  function clearSession() {
    Object.values(STORAGE).forEach((key) =>
      sessionStorage.removeItem(key)
    );
  }

  function loadSession() {
    const token = sessionStorage.getItem(STORAGE.TOKEN);
    const expiry = Number(sessionStorage.getItem(STORAGE.EXPIRY));

    if (!token || !expiry || expiry <= Date.now() + 60000) {
      clearSession();
      return null;
    }

    return token;
  }

  function init() {
    return new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) {
        reject(new Error("Google Identity Services failed to load."));
        return;
      }

      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(new Error(response.error || "Google authentication failed."));
            return;
          }

          saveSession(response.access_token, response.expires_in);
          resolve(response.access_token);
        },
      });

      resolve(tokenClient);
    });
  }

  async function requestToken(prompt = "") {
    if (!tokenClient) await init();

    return new Promise((resolve, reject) => {
      tokenClient.callback = (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error || "Google authentication failed."));
          return;
        }

        saveSession(response.access_token, response.expires_in);
        resolve(response.access_token);
      };

      tokenClient.requestAccessToken({ prompt });
    });
  }

  async function getGoogleIdentity(token) {
    const response = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!response.ok) {
      throw new Error("Unable to verify your Google account.");
    }

    const identity = await response.json();

    if (!identity.email || identity.email_verified !== true) {
      throw new Error("Your Google email could not be verified.");
    }

    return identity;
  }

  async function resolveRole(token) {
    const identity = await getGoogleIdentity(token);
    const email = identity.email.toLowerCase();

    const sheetResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}?fields=spreadsheetId`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!sheetResponse.ok) {
      throw new Error("You do not have access to the dashboard spreadsheet.");
    }

    let role;

    if (email === CONFIG.OWNER_EMAIL.toLowerCase()) {
      role = "owner";
    } else {
      const driveResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${CONFIG.DRIVE_FILE_ID}?fields=capabilities(canEdit)`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!driveResponse.ok) {
        throw new Error("Unable to verify your spreadsheet permissions.");
      }

      const file = await driveResponse.json();
      role = file.capabilities?.canEdit ? "editor" : "viewer";
    }

    sessionStorage.setItem(STORAGE.ROLE, role);
    sessionStorage.setItem(STORAGE.EMAIL, email);

    return role;
  }

  async function signIn() {
    try {
      await init();
      await requestToken("consent");
      window.location.href = DASHBOARD_URL;
    } catch (error) {
      console.error("Sign-in failed:", error);
      alert(error.message || "Unable to sign in.");
    }
  }

  async function requireSession(onReady) {
    try {
      let token = loadSession();

      if (!token) {
        await init();
        token = await requestToken("");
      }

      const role = await resolveRole(token);

      if (typeof onReady === "function") {
        onReady(role);
      }

      return role;
    } catch (error) {
      console.error("Access verification failed:", error);
      clearSession();
      window.location.href = LOGIN_URL;
      return null;
    }
  }

  function signOut() {
    const token = sessionStorage.getItem(STORAGE.TOKEN);

    if (token && window.google?.accounts?.oauth2) {
      google.accounts.oauth2.revoke(token);
    }

    clearSession();
    window.location.href = LOGIN_URL;
  }

  function authHeaders() {
    const token = loadSession();

    if (!token) {
      throw new Error("Your session has expired. Please sign in again.");
    }

    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  function getToken() {
    return loadSession();
  }

  function getRole() {
    return sessionStorage.getItem(STORAGE.ROLE);
  }

  function getEmail() {
    return sessionStorage.getItem(STORAGE.EMAIL);
  }

  function isEditor() {
    return ["owner", "editor"].includes(getRole());
  }

  function isOwner() {
    return getRole() === "owner";
  }

  return {
    init,
    signIn,
    signOut,
    requireSession,
    resolveRole,
    authHeaders,
    getToken,
    getRole,
    getEmail,
    isEditor,
    isOwner,
  };
})();