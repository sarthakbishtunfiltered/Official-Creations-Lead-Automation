// ============================================================
// AUTH — Google sign-in, OAuth token, and role detection.
//
// Design: the site never stores its own permissions. It asks
// the user to sign in with Google, requests an access token
// scoped to Sheets/Drive, and lets Google's own ACLs decide
// what that token can read or write. A user's role here is
// exactly their Viewer/Editor role on the Lead Database sheet.
// ============================================================

const Auth = (() => {
  let tokenClient = null;
  let accessToken = null;
  let role = null; // "editor" | "viewer" | null (no access)

  function init(onReady) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
      ].join(" "),
      callback: async (resp) => {
        if (resp.error) {
          onReady({ ok: false, error: resp.error });
          return;
        }
        accessToken = resp.access_token;
        const result = await resolveRole();
        onReady(result);
      },
    });
  }

  function signIn() {
    tokenClient.requestAccessToken({ prompt: "consent" });
  }

  function signOut() {
    if (accessToken) {
      google.accounts.oauth2.revoke(accessToken, () => {});
    }
    accessToken = null;
    role = null;
    sessionStorage.clear();
    window.location.href = "index.html";
  }

  // Determine editor/viewer/none. Source of truth is always the
  // real Sheets API call result (403 => no access); the Drive
  // permission check below is only used to decide up-front
  // whether to render edit controls, as a UX nicety.
  async function resolveRole() {
    try {
      // A cheap read call — also doubles as an access check.
      const testUrl = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}?fields=spreadsheetId`;
      const readCheck = await fetch(testUrl, { headers: authHeaders() });
      if (readCheck.status === 403 || readCheck.status === 404) {
        return { ok: false, error: "no_access" };
      }
      if (!readCheck.ok) {
        return { ok: false, error: "unknown" };
      }

      // Determine editor vs viewer via Drive permissions for "me".
      const permUrl = `https://www.googleapis.com/drive/v3/files/${CONFIG.DRIVE_FILE_ID}?fields=capabilities(canEdit)`;
      const permResp = await fetch(permUrl, { headers: authHeaders() });
      if (permResp.ok) {
        const data = await permResp.json();
        role = data.capabilities && data.capabilities.canEdit ? "editor" : "viewer";
      } else {
        // Fall back: assume viewer if we can read but can't check capabilities.
        role = "viewer";
      }
      sessionStorage.setItem("occ_role", role);
      return { ok: true, role };
    } catch (e) {
      return { ok: false, error: "network" };
    }
  }

  function authHeaders() {
    return { Authorization: `Bearer ${accessToken}` };
  }

  function getToken() {
    return accessToken;
  }

  function getRole() {
    return role || sessionStorage.getItem("occ_role");
  }

  function isEditor() {
    return getRole() === "editor";
  }

  // Every authenticated page (dashboard/leads/etc.) calls this on
  // load. If there's no live token in memory (e.g. page refresh),
  // it silently re-requests one instead of forcing a manual sign-in.
  function requireSession(onReady) {
    init((result) => {
      if (!result.ok) {
        window.location.href = "index.html?denied=" + (result.error || "unknown");
        return;
      }
      onReady(result);
    });
    tokenClient.requestAccessToken({ prompt: "" });
  }

  return { init, signIn, signOut, getToken, getRole, isEditor, requireSession, authHeaders };
})();