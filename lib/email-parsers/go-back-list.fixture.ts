// The real multi-site email from NetView (2026-07-28) — 18 sites, one work
// order each. Kept complete rather than trimmed, because the whole point of
// this parser is that it finds ALL of them, and every format variant Karen
// typed appears somewhere in the list:
//
//   "Site ID 1331"           no colon
//   "Site ID: 9291"          colon
//   "Site ID  452"           no colon, double space
//   "Site ID : 11503"        space before the colon
//   "Site Name : Rising Sun" space before the colon
//   "Address" / "Address:" / "Site Address:" / "Site Address :"
//
// Phone number removed. The Drive links stay because keeping them out of the
// description is part of what's under test.
export const GO_BACK_LIST = `From: karen.sparkman <karen.sparkman@teamnetview.example>
Sent: Tue, Jul 28, 2026 9:52 PM
To: me, brandi.bowen
Subject: RE: Wendys / NJ & Philli Project / List of Go-Backs / UPDATED / USE THIS ONE w/ Links

Frederick,

Here are the remaining sites that need "something" done.   I know it is A LOT to ask but most of these should take manual time to complete.  Aside from West Deptford (Rack Move)  I am looking to have these done by Friday July 31, 2026.

Please let me know which ones you can have completed and which ones I need to farm out to different Techs.

Of course, all of them are priority but Hillside (1331) and Fox Street (11126) are TOP.   We need to get the materials / Inventory from Fox Street as the manager was told it was going to be picked up this past weekend.

Site ID 1331

Site Name Hillside

Address: 410 Route 221 Hillside, NJ 07205

Scope: Q-Board and COB are black.  Check to ensure that they are connected and updated.

All cameras are showing offline

Site ID 8349

Site Name BAYONNE

Address 181 Lefante Way Bayonne, NJ 07002

Scope    4U Rack needs to be installed (currently sitting on shelf)

Kiosk Table needs to be completed (lines are ran just missing the faceplates / biscuit boxes)

Add blanks to Rack,

Missing the following photos -  AP install locations, and Photo for faceplate A2, A47, A26,   Missing photos for Kiosk table.

Clean ALL cameras as they are DIRTY

https://drive.google.com/drive/folders/13mlQHAzg3sOKes2GUYKIKb8AiNWKApdP?usp=sharing

Site ID 8526

Site Name WEST DEPTFORD

Address   488 Crown Point Road. West Deptford, NJ 19134

Scope Rack needs to be moved into managers office

https://drive.google.com/drive/folders/1mdnAf4Km8ReiMVwhPrckLo7PER4n5SNh?usp=sharing

Site ID  452

Site Name   ARAMINGO

Address   3600 Aramingo Ave.  Philadelphia, PA 19134

Scope -Missing Chase way: B1 box,  A29 box under front counter area.

-Music needs plugged in in either B19 OR a patch cable from the music device plugged into switch B39 directly."

- Clean Kitchen 1 camera.  It is DIRTY

https://drive.google.com/drive/folders/15Bt5vVRLZPeQrSHlapIBNoDO0nkOmTn0?usp=sharing

Site ID 2642

Site Name Cottman

Address 2301 Cottman Avenue Philadelphia, PA19149

Scope   Front counter needs corrected.

-Check ALL menu boards and Q-Boards for updates and that they show ONLINE

- Clean ALL cameras as they are DIRTY

https://drive.google.com/drive/folders/1yn9Cx7nDFGxdTHel9-yGYK8OwrHfGULP?usp=sharing

Site ID  11126

Site Name FOX STREET

Address   2920 Fox Street.  Philadelphia, PA 19129

Scope :   PLEASE PICK up materials / Inventory left from other Team. It was left with the manager.

-Music system is not plugged into Switch 2 - 38.

-A17 A36 no terminations above ceiling tiles.

- Check ALL menu boards and Q-boards for updates and that they show ONLINE

- Clean ALL cameras as they are DIRTY

https://drive.google.com/drive/folders/1za5BXJA6TUlu9c-qA_Z67511b7wsid25?usp=sharing

Site ID   5800

Site Name   KELLOGG

Address    401 State Rt 440   Jersey City, NJ. 07305

Scope   -Music system is not plugged into Switch 2 - 38

-No Photos of EnVR install"

- Clean ALL cameras as they are DIRTY

https://drive.google.com/drive/folders/1R6KydTm2lz6hzNMLCAasBziMhZgMhw99?usp=sharing

Site ID 945

Site Name  :City Ave Center

Address   7700 City Line Avenue.  Philadelphia, PA 19151

Scope   -Music system is not plugged into Switch 2 – 38

Clean ALL cameras as they are DIRTY

https://drive.google.com/drive/folders/1V48m6eIRSG3ZD4AiZb6cXU2-84T56g6-?usp=sharing

Site ID 11804

Site Name South Brunswick

Address 2533 Route 130.  Cranbury, NJ 08512

Scope:  Check ALL menu boards and Q-boards for updates and that they show ONLINE

- Was dispatched for a DMB not being on, discovered that it did not have a network cable or connection for the controller, the other three controllers had connections but still are using the old CAT5e jacks and cabling as the rack appears to have CAT5e and CAT6 run to it.

https://drive.google.com/drive/folders/1d0hSG6XP5wmeQcISmlp0n1XR8yl_Y3lG?usp=sharing

Site ID 2445

Site Name : Rising Sun

Site Address : 501 ADAMS AVENUE.  PHILADELPHIA, PA 19120

Scope   Office camera is blocked by office rack.   Please move it to a better angle.  Clean all cameras while onsite."

Check ALL menu boards and Q-boards for updates and that they show ONLINE

https://drive.google.com/drive/folders/1l0sjbN35ES217sASqoWQJCgvlwjKJOWV?usp=sharing

Site ID: 9291

Site Name: Swedesboro

Site Address:  320 Village Center Dr.  Swedesboro, NJ 08085

Scope:  Need to run new POTS line (just use CAT6 and pick 2 colors to use)

https://drive.google.com/drive/folders/1dZYFAwA60zhUsedKfRs0ie-t9KNbPXH4?usp=sharing

Site ID : 11503

Site Name: Centerton

Site Address: 74 Centerton Road. Mt Laurel, NJ 08054

Scope: Need to run new POTS line (just use CAT6 and pick 2 colors to use)

https://drive.google.com/drive/folders/16JtXik-2JuwwT0rH7aLgtuOIA3BaID43?usp=sharing

Site ID: 9737

Site Name: Hackesttown

Site Address: 219 Mountain Avenue. Hackettstown, NJ 07840

Scope: Need to run new POTS line (just use CAT6 and pick 2 colors to use)

Check Interior Drive Thru Camera as it is showing OFFLINE

https://drive.google.com/drive/folders/1VHdBhPQ-RMui8j8q2o23mkHhNdyUDmj8?usp=sharing

Site ID  10548

Site Name Ridge

Address: 5901 Ridge Avenue Philadelphia, PA 19128

Scope :  Need to run new POTS line (just use CAT6 and pick 2 colors to use)

Check ALL menu boards and Q-boards for updates and that they show ONLINE

https://drive.google.com/drive/folders/1MoqzSkjmmjyRLCtirTgLSMExNki13vLQ?usp=sharing

Site ID 9531

Site Name:  Columbus

Address: 2130 S Christopher Columbus Blvd.  Philadelphia, PA 19148

Scope:  -Music system is not plugged into Switch 2 - 38
-Blanks missing from Rack

https://drive.google.com/drive/folders/1bLKVu5Wn3EPKjD-qbAqEqMDeBluuQKkz?usp=sharing

Site ID  5597

Site Name  Garfield

Address  2-30 Garfield Avenue. Jersey City, NJ 07305

Scope  -Music system is not plugged into Switch 2 - 38

https://drive.google.com/drive/folders/1fg36mmXn1qWSijbtet2oTzJWvl26KU-L?usp=sharing

Site ID 2643

Site Name : Hunting Park

Address: 700 E Hunting Park, Philadelphia, PA 19124

Scope: -Music system is not plugged into Switch 2 - 38
-Blanks missing from Rack

https://drive.google.com/drive/folders/1F4fBx34YJZt4w8dERVHdBnPCyIAiwNia?usp=sharing

Site ID  2279

Site Name   Island Ave

Address   3000 Island Avenue.  Philadelphia, PA 19153

Scope   Music system is not plugged into Switch 2 - 38

https://drive.google.com/drive/folders/1lFYt2jrUIGbdLCxw-6HiC9ZwDtrjmT5m?usp=sharing

Karen Sparkman
NetView
`;

/** The 18 site numbers in the order they appear. */
export const GO_BACK_SITE_IDS = [
  '1331', '8349', '8526', '452', '2642', '11126', '5800', '945', '11804',
  '2445', '9291', '11503', '9737', '10548', '9531', '5597', '2643', '2279',
];
