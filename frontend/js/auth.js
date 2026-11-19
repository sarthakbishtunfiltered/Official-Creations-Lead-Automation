const Auth = (() => {
  const STORAGE = {
    TOKEN: "occ_access_token",
    EXPIRY: "occ_token_expires_at",
    ROLE: "occ_role",
    EMAIL: "occ_user_email",
    CAN_APPROVE: "occ_can_approve",
  };

  const SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    // Only asked for when call-recording upload is switched on in config.js.
    ...(typeof CONFIG !== "undefined" && String(CONFIG.RECORDINGS_FOLDER_ID || "").trim()
      ? ["https://www.googleapis.com/auth/drive.file"]
      : []),
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

  // An Error that carries a short code, so the sign-in page can show
  // the right message (see ?denied= handling in index.html).
  function accessError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  // Looks the person up on the Team tab (Email | Rank | Can Approve ...).
  // Returns { member } when found, or { member: null, why } where why is
  // one of: tab_missing, empty, no_email_column, no_row.
  async function lookupTeamMember(token, email) {
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(CONFIG.TABS.TEAM)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    // 400 = the Team tab does not exist (or is named differently).
    if (response.status === 400) {
      return { member: null, why: "tab_missing" };
    }

    if (!response.ok) {
      throw accessError("unknown", "Unable to read the team list.");
    }

    const data = await response.json();
    const values = data.values || [];

    if (values.length < 2) {
      return { member: null, why: "empty" };
    }

    const headers = values[0].map((h) => String(h).trim().toLowerCase());
    const emailIdx = headers.indexOf("email");
    const rankIdx = headers.indexOf("rank");
    const approveIdx = headers.indexOf("can approve");

    if (emailIdx === -1) {
      return { member: null, why: "no_email_column" };
    }

    const row = values
      .slice(1)
      .find(
        (r) =>
          String(r[emailIdx] ?? "").trim().toLowerCase() === email
      );

    if (!row) {
      return { member: null, why: "no_row" };
    }

    const approveValue = String(row[approveIdx] ?? "").trim().toLowerCase();

    return {
      member: {
        rank: String(row[rankIdx] ?? "").trim().toLowerCase(),
        canApprove: ["true", "yes", "1", "\u2713"].includes(approveValue),
      },
    };
  }

  // Who can sign in, and as what:
  //  - The Owner (CONFIG.OWNER_EMAIL) always gets in and can do everything.
  //  - Anyone else needs BOTH real access to the Google Sheet AND a row on
  //    the Team tab. Google's own permission (Drive canEdit) is still the
  //    ceiling: a Team "Editor" without Sheet edit access is only a Viewer.
  //  - "Can Approve" only counts for Editors.
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
      throw accessError(
        sheetResponse.status === 403 || sheetResponse.status === 404
          ? "no_access"
          : "unknown",
        "You do not have access to the dashboard spreadsheet."
      );
    }

    let role;
    let canApprove = false;

    if (email === CONFIG.OWNER_EMAIL.toLowerCase()) {
      role = "owner";
      canApprove = true;
    } else {
      const driveResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${CONFIG.DRIVE_FILE_ID}?fields=capabilities(canEdit)`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!driveResponse.ok) {
        throw accessError(
          "unknown",
          "Unable to verify your spreadsheet permissions."
        );
      }

      const file = await driveResponse.json();
      const driveCanEdit = Boolean(file.capabilities?.canEdit);

      const { member, why } = await lookupTeamMember(token, email);

      if (!member) {
        const denied = accessError(
          "not_on_team",
          "This account has not been added to the team."
        );
        denied.email = email;
        denied.why = why;
        throw denied;
      }

      role = member.rank === "editor" && driveCanEdit ? "editor" : "viewer";
      canApprove = role === "editor" && member.canApprove;
    }

    sessionStorage.setItem(STORAGE.ROLE, role);
    sessionStorage.setItem(STORAGE.EMAIL, email);
    sessionStorage.setItem(STORAGE.CAN_APPROVE, canApprove ? "true" : "false");

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
      window.location.href = error.code
        ? `${LOGIN_URL}?denied=${encodeURIComponent(error.code)}` +
          (error.email ? `&email=${encodeURIComponent(error.email)}` : "") +
          (error.why ? `&why=${encodeURIComponent(error.why)}` : "")
        : LOGIN_URL;
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

  // Owner, or an Editor the Owner flagged "Can Approve" on the Team tab.
  function canApprove() {
    return sessionStorage.getItem(STORAGE.CAN_APPROVE) === "true";
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
    canApprove,
  };
})();