# Pipeline + cycles: setup (about 10 minutes)

## 1. Leads sheet: add these headers to row 1 (next to the existing ones)
`Stage` `Stage Note` `Stage Updated At` `Stage Updated By` `Recording` `Cycle`
Only `Stage` is required. Existing leads have a blank Stage, which counts as Round 1.

## 2. New tab "Cycles" (row 1 headers)
`Cycle ID` `Name` `Number` `Niche` `Limit` `Created By` `Created At` `Sent At` `Sent Count`

## 3. Optional tab "Stage History" (row 1 headers)
`Timestamp` `Lead ID` `Business Name` `From` `To` `Note` `By` `Recording`
Every stage move is logged here (who, when, note, recording). Skip the tab and nothing is logged.

## 4. config.js (do NOT replace your file; add these inside CONFIG)
In TABS, after APPROVALS:
    CYCLES: "Cycles",
    STAGE_HISTORY: "Stage History",
After TABS:
    DEFAULT_CYCLE_LIMIT: 20,
    RECORDINGS_FOLDER_ID: "",   // see step 6; leave blank to allow pasted links only

## 5. Apps Script
Replace notify_on_approve.gs, Save, then Deploy > Manage deployments > edit > New version.
If Google asks for permissions, accept them.

## 6. Optional: recording upload to Drive
Create a Drive folder, share it with your editors (Editor access), paste its ID
(the end of the folder URL) into RECORDINGS_FOLDER_ID. Everyone must sign out and sign in
once to grant the extra "files created by this app" permission. Files over 25 MB:
paste a link instead.
