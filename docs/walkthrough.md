# Two-minute walkthrough video script

A simple script for recording a screen-capture video of about two minutes. Speak slowly. It is fine to run a little over or under.

**Video link:** `PASTE YOUR VIDEO LINK HERE AFTER YOU UPLOAD IT` (YouTube "unlisted", Google Drive with link sharing, or Loom).
Then copy the same link into the README (section "Walkthrough video").

## Before you record (5 minutes)

1. Use a **fresh database** so the demo starts clean: close the app, delete `database\internship-board.db`, then run `npm start`.
2. Open two browser tabs: the **live Render website** (or `http://localhost:3000`) and `/api/health`.
3. Resize the browser window to normal desktop size. Close other tabs and notifications.
4. Have a **second PowerShell window** ready in the project folder (for the test run).
5. Pick demo data to type: name `Asha Verma`, email `asha@example.com`, resume `https://example.com/asha-resume.pdf`.
6. Practise once. Windows: **Win + G** (Xbox Game Bar) or **OBS Studio** (free) can record the screen.

## Script (target 2:00)

| Time | What to show | What to say (read aloud, change the words if you like) |
|------|--------------|-------------------------------------------------------|
| 0:00 – 0:10 | **Introduction.** Homepage top | "Hi, I'm *your name*. This is my EdVyro Task 4 project, the Internship Board: a full-stack portal built with Node.js, Express, SQLite and plain HTML, CSS and JavaScript." |
| 0:10 – 0:25 | **Homepage and listings.** Scroll slowly past the hero to the cards | "The landing page has a menu, a short introduction and the internship cards. Every card is loaded from my REST API, not typed into the page. Each card shows the domain, work mode, location, openings and skills." |
| 0:25 – 0:45 | **Search and filters.** Type `sql`, then choose Mode = Hybrid, then Clear. Type `zzz` to show the empty message | "I can search by title, domain, location or skill. Results update as I type. I can also filter by domain and work mode. If nothing matches, I get a helpful message and a Clear button. Notice the page address changes, so I could share this exact search." |
| 0:45 – 0:55 | **Pagination and responsive.** (If there is only one page, skip pagination.) Press `F12`, click the device icon, choose a phone width (360) and show the menu button and the cards in one column | "The layout is responsive. At phone width the menu collapses into a button, the cards stack, and there is no sideways scrolling." |
| 0:55 – 1:10 | **Internship details.** Click *View details* on one card. Show skills and the form. Press `Esc` | "The details open in an accessible dialog. It can be closed with Escape, and the keyboard focus goes back to the button I used." |
| 1:10 – 1:35 | **Application form, validation and duplicates.** Open details again. Click Submit with empty fields. Type `javascript:alert(1)` as the resume link and submit. Fix it with the `https://` link and submit. Then apply again with the same email | "Empty fields show clear messages next to each field. A dangerous link such as `javascript:` is rejected. A valid application gives a confirmation with a reference number. If I apply again with the same email for the same internship, I get a friendly duplicate message. The database itself also enforces this rule." |
| 1:35 – 1:50 | **Backend, API and security.** Switch to the `/api/health` tab, then the PowerShell window: run `npm test` and let the summary show | "The API reports its own health, including the database. I have **N** automated tests covering the API, validation, duplicates, security headers, rate limiting, logging and the front end. Security includes Helmet headers, a strict Content Security Policy, rate limiting, size limits and parameterised SQL. Logs never contain applicant names, emails, resume links or cover letters." *(Replace N with the number your own `npm test` prints.)* |
| 1:50 – 2:00 | **Deployment and conclusion.** Show the live Render URL in the address bar | "It is deployed on Render's free plan. The free plan has no permanent disk, so the demo database can reset when the service restarts. Thank you for watching." |

## Tips

- If Render has been idle it can take about a minute to wake up. Open the live site **before** recording so it is awake.
- If you make a mistake, keep going or re-record that part only; you can trim in any simple editor.
- Do not show `.env` files or any real personal data. The demo email above is fake.
- Upload the video, copy the link, and paste it at the top of this file and into the README.
