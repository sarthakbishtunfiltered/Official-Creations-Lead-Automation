const Auth = (() => {
  let tokenClient = null;
  let accessToken = null;
  let role = null;
  let tokenExpiresAt = 0;

  const TOKEN_KEY = "occ_access_token";
  const EXPIRY_KEY = "occ_token_expires_at";
  const ROLE_KEY = "occ_role";

  function loadSession() {
    accessToken = sessionStorage.getItem(TOKEN_KEY);
    tokenExpiresAt =
      parseInt(sessionStorage.getItem(EXPIRY_KEY) || "0", 10);
    role = sessionStorage.getItem(ROLE_KEY);

    // Keep a small safety buffer so we do not reuse a token
    // that is about to expire.
    if (
      !accessToken ||
      !tokenExpiresAt ||
      Date.now() >= tokenExpiresAt - 60000
    ) {
      accessToken = null;
      tokenExpiresAt = 0;
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(EXPIRY_KEY);
    }
  }

  function init(onReady) {
    loadSession();

    if (accessToken && role) {
      onReady({
        ok: true,
        role,
        cached: true,
      });
      return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,

      scope: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
      ].join(" "),

      callback: async (resp) => {
        if (resp.error) {
          onReady({
            ok: false,
            error: resp.error,
          });
          return;
        }

        accessToken = resp.access_token;

        const expiresIn =
          Number(resp.expires_in) || 3600;

        tokenExpiresAt =
          Date.now() + expiresIn * 1000;

        sessionStorage.setItem(
          TOKEN_KEY,
          accessToken
        );

        sessionStorage.setItem(
          EXPIRY_KEY,
          String(tokenExpiresAt)
        );

        const result = await resolveRole();

        onReady(result);
      },
    });
  }

  function signIn() {
    if (!tokenClient) {
      init(() => {});
    }

    tokenClient.requestAccessToken({
      prompt: "consent",
    });
  }

  function signOut() {
    if (accessToken) {
      google.accounts.oauth2.revoke(
        accessToken,
        () => {}
      );
    }

    accessToken = null;
    role = null;
    tokenExpiresAt = 0;

    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EXPIRY_KEY);
    sessionStorage.removeItem(ROLE_KEY);

    window.location.href = "index.html";
  }

  async function resolveRole() {
    try {
      const testUrl =
        `https://sheets.googleapis.com/v4/spreadsheets/` +
        `${CONFIG.SPREADSHEET_ID}?fields=spreadsheetId`;

      const readCheck = await fetch(testUrl, {
        headers: authHeaders(),
      });

      if (
        readCheck.status === 403 ||
        readCheck.status === 404
      ) {
        return {
          ok: false,
          error: "no_access",
        };
      }

      if (!readCheck.ok) {
        return {
          ok: false,
          error: "unknown",
        };
      }

      const permUrl =
        `https://www.googleapis.com/drive/v3/files/` +
        `${CONFIG.DRIVE_FILE_ID}` +
        `?fields=capabilities(canEdit)`;

      const permResp = await fetch(
        permUrl,
        {
          headers: authHeaders(),
        }
      );

      if (permResp.ok) {
        const data = await permResp.json();

        role =
          data.capabilities &&
          data.capabilities.canEdit
            ? "editor"
            : "viewer";
      } else {
        role = "viewer";
      }

      sessionStorage.setItem(
        ROLE_KEY,
        role
      );

      return {
        ok: true,
        role,
      };
    } catch (e) {
      console.error(
        "Role resolution failed:",
        e
      );

      return {
        ok: false,
        error: "network",
      };
    }
  }

  function authHeaders() {
    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }

  function getToken() {
    loadSession();
    return accessToken;
  }

  function getRole() {
    return (
      role ||
      sessionStorage.getItem(ROLE_KEY)
    );
  }

  function isEditor() {
    return getRole() === "editor";
  }

  function requireSession(onReady) {
    loadSession();

    // Fast path:
    // valid token + known role = no Google OAuth request,
    // no Sheets request, no Drive request.
    if (accessToken && role) {
      onReady({
        ok: true,
        role,
        cached: true,
      });
      return;
    }

    init((result) => {
      if (!result.ok) {
        window.location.href =
          "index.html?denied=" +
          (result.error || "unknown");

        return;
      }

      onReady(result);
    });

    // Only request a token when the cached session
    // cannot be reused.
    if (!accessToken || !role) {
      tokenClient.requestAccessToken({
        prompt: "",
      });
    }
  }

  return {
    init,
    signIn,
    signOut,
    getToken,
    getRole,
    isEditor,
    requireSession,
    authHeaders,
  };
})();