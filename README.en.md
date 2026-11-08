# HEART RELAY

[日本語](README.md) | [English](README.en.md)

**An AI-Assisted System for Collecting, Organizing, and Delivering Information to the Right People in Care and Healthcare Settings**

*The right information, to the right people, in the right way.*

HEART RELAY explores how AI might help address communication problems in care and healthcare workplaces.

This public repository contains an experimental prototype developed for **Built with Claude: Japan 2026**, submitted on **November 8, 2026**. It is not a production-ready system for use with real patient or staff data.

## Demo (Built with Claude: Japan 2026)

- **[Watch the v3 demo (YouTube, under 3 minutes)](https://youtu.be/3FyNFSp07fU)**
- Submitted: **November 8, 2026** · Theme: **“The Depth Only You Can Bring”** (「あなたにしかない深さを」) · Team: **Team HEART RELAY**
- [v3 video script (Japanese)](docs/demo/台本_v3.md) · [Production report (Japanese)](docs/reports/動画制作_2026-11-08.md)
- **The opening illustrated story is an anonymized reconstruction of the developer's real experience.** All people, workplaces, and messages used in the software demonstration are fictional.

## 1. Why HEART RELAY Exists

The developer works on the frontline of day care for older adults.

The project began with a real incident during a return-home shuttle trip. The driver learned by phone—while already on the route—that a passenger needed to be home for a scheduled medical visit. Despite changing the route, the vehicle arrived late, and the driver faced complaints. Back at the facility, the relevant paper notice was found: **the information existed, but it had never reached the person organizing the transportation.**

In another incident, a medication change was recorded but not adequately communicated to the nurse responsible. Another experienced staff member noticed the discrepancy before an incorrect medication could be given.

In smaller care workplaces, the people handling communications are often also caring for residents. HEART RELAY aims to let Claude prepare the message and suggest recipients, while staff quickly review, correct, and approve it before returning to care. **The goal is not just efficiency: it is to reduce the emotional toll on frontline workers when preventable communication gaps lead to complaints or blame.**

Every day, workplaces face a range of challenges: complaints from people receiving care and their families, misunderstandings among staff, and concerns or criticism from supervisors and organizational leadership. Not all of these problems are caused by communication failures. But through firsthand experience, the developer has come to believe that many share a common factor: **information that needs to reach someone does not reach the right person, at the right time, in a usable form.**

The cause is not necessarily a major technical failure or anyone's ill intent. It may be a missing routine, a forgotten handoff, a confirmation that never happened, or a small difference in understanding. Ordinary gaps like these can accumulate into serious problems.

At the same time, many frontline workers approach their responsibilities with genuine dedication and care. Yet when information does not reach its destination, it is often the people closest to those receiving care who end up facing complaints or reprimands.

Frontline workers can develop distrust toward managers and executives. But many people in leadership are also sincerely trying to do right by those receiving care, their employees, and the long-term sustainability of their organizations. This project is not about assigning blame to one side. **Perhaps a lack of shared information and understanding is itself widening the distance between people who are trying to do their best.**

The aim is therefore to explore a practical way to reduce missed handoffs, prevent important information from getting buried, and make communication more reliable. The rapid development of AI offers one possible path.

## 2. Why This Matters Now

Japan's aging population and staffing pressures create a very real sense of urgency for people working in care and healthcare.

According to Japan's Cabinet Office *Annual Report on the Ageing Society 2026*, the number of people aged 65 and older is projected to peak at approximately **39.53 million in 2043**. Even after that population begins to decline, the proportion of older people in Japan's total population is expected to keep rising.

Japan's Ministry of Health, Labour and Welfare estimates that the number of care workers required will grow from approximately **2.15 million in fiscal 2022 to 2.72 million in fiscal 2040**.

Those projections identify milestones, but they do not erase a pressing question for people on the ground: **Can our care workplaces sustain themselves until then?**

There are too few people, too few hours in the day, and limited budgets. Yet it is no longer realistic to keep postponing communication problems simply because they are difficult to solve.

**Helping smaller teams share essential information reliably, without unreasonable burdens or excessive costs, is not merely a convenience.** It may become one of the systems that allow care workplaces to keep functioning.

HEART RELAY begins with both this practical challenge and a deep concern for the people doing the work.

Sources:

- [Cabinet Office, Japan — Annual Report on the Ageing Society 2026 (Japanese)](https://www8.cao.go.jp/kourei/whitepaper/w-2026/html/zenbun/s1_1_1.html)
- [Ministry of Health, Labour and Welfare — Estimated Care Workforce Requirements (Japanese)](https://www.mhlw.go.jp/stf/newpage_41379.html)

## 3. What HEART RELAY Aims to Do

Information reaches care and healthcare workplaces in many forms: spoken handovers, handwritten notes, faxes, digital records, and phone calls.

HEART RELAY envisions a way to bring these communications together, organize their meaning, and **tailor both the recipient and the format of each message to the person's role, responsibilities, and need to know.**

- Collect communications and use AI to categorize and summarize them.
- Support decisions about who needs to receive each item, based on defined rules and staff responsibilities.
- Deliver relevant information to each intended staff member in a clear, individual message.
- Go beyond marking a message as “sent”: record when a recipient explicitly acknowledges it.
- Make unacknowledged messages and potential gaps in communication visible.

Broadcasting every message to everyone can bury what matters most. The goal is not to generate more messages, but to make sure **the right information arrives and its receipt can be confirmed.**

## 4. Implemented and Tested in the Hackathon (as of November 8, 2026)

The prototype demonstrates an end-to-end flow using fictional data and a physical Pixel 10a: **enter a message on the PC → Claude proposes content and recipients → a staff member reviews and approves → Android receives and acknowledges → the PC shows the acknowledgement.**

- **Input:** Text via PC or mobile web; Claude-assisted extraction from images, photos, and PDFs with human correction; local text extraction from TXT/DOCX/XLS/XLSX; browser-based speech recognition.
- **AI-assisted preparation:** Summaries, categories, urgency, recommended actions, audience suggestions, and explanations for excluded recipients. The demo uses a fictional registry of 200 care recipients and staff responsibility data. Ambiguous identities require human selection.
- **Human control:** A person checks and edits the source text, identity, recipients, and message, then explicitly approves delivery. Claude does **not** send messages autonomously.
- **Acknowledgement tracking:** Staff read messages in the Android app and tap “Acknowledged”; the PC displays who acknowledged and when.
- **Shared notice board:** A browser display for general floor announcements.
- **Cross-office communication (prototype):** Three fictional offices demonstrate assisted drafting, human-initiated sending, and acknowledgement tracking. Production-grade authentication and authorization are **not implemented**.

**Verified:** End-to-end delivery and acknowledgement with the real Claude API, PC web interface, and physical Android device. The Android app also connected directly to the PC over Wi-Fi without ADB.

**Known limits:** Direct access from Pixel Chrome to the PC over LAN remained unreliable for unknown reasons; the mobile-web test used ADB reverse. Background push delivery, real-world access controls, and production use with personal data are not implemented.

- [Device and integration test report (Japanese)](docs/reports/実機検証_UI刷新_Issue2_2026-11-07.md)
- [Setup instructions (Japanese)](docs/起動手順.md)

## 5. A Longer-Term Vision: On-Premises Local LLMs

In the future, the goal is to explore **on-premises local LLMs** running within an environment managed by the care provider, so that information can be processed without being sent to an external AI service.

Care and healthcare information often requires particularly careful handling. Local processing could be an important option for workplaces where sending information to third-party services is difficult.

As local LLMs improve and become more affordable, smaller organizations may be able to use modest hardware, while larger care and healthcare groups could adopt the same principles with dedicated servers and more extensive administration.

However, **a local LLM alone does not guarantee privacy, security, or legal compliance.** Any real deployment would also need appropriate access controls, operating policies, data protection, auditability, and clear accountability.

## 6. Important Notice: Experimental Development and Personal Information

HEART RELAY is an **experimental hackathon prototype** intended to explore AI-assisted information collection, decision support, and targeted communication in care and healthcare settings.

The motivation comes from real experiences, but **all names, profiles, schedules, facilities, and messages in the prototype and its software demonstration are fictional simulation data**. External AI testing uses only this fictional data. Real personal information about care recipients or employees is not used, submitted to external AI services, or published in this repository.

Before any future use in a real workplace, the project would need to examine the purposes of data use, how service providers handle information, relevant laws, contracts, and facility policies. It would also require appropriate approvals and technical and organizational safeguards. Japanese personal information protection law does not categorically ban the use of external AI; compliance depends on the specific way information is handled.

**The current prototype is not intended for operational processing of real personal information.**

## 7. What This Project Hopes to Show

HEART RELAY is not presented as a complete solution to every problem. AI can make mistakes when classifying and routing information, and meaningful real-world deployment would require substantial further work.

Even so, the project hopes to demonstrate one direction worth exploring: reducing preventable problems caused by missed communications, and easing unnecessary misunderstandings between frontline staff and management, and between people receiving care and their families.

**What can technology do to help people continue caring for one another?**

HEART RELAY is one attempt to explore that question.

## 8. Repository and Screen Layout (November 8, 2026 submission)

- `backend/`: Node.js, Express, SQLite, and Claude API integration
- `web/`: Static single-page web application and shared board
- `android/`: Kotlin / Jetpack Compose staff-facing acknowledgement app
- `fixtures/`: Fictional registry of 200 care recipients
- `docs/`: API, setup, design, tests, and demo scripts
- `tools/`: Demo recording and video-editing scripts

[API contract](docs/api.md) · [Setup instructions (Japanese)](docs/起動手順.md)

### Screen layout (UI refresh, November 7, 2026)

The PC screen is a single page (`web/index.html`) that switches views by hash routing:

- `#/home` Home: today's delivery, unacknowledged, and acknowledged counts, plus today's messages
- `#/new` New message: enter, review the AI proposal, approve
- `#/deliveries` and `#/deliveries/<id>` Delivery management: list and detail (acknowledgement status per staff member, AI selection rationale)
- `#/corp` Cross-office communication: assisted drafts, manual sending, acknowledgement status (fictional offices)
- Shared board `board.html`: opens in a new tab

Design record (in Japanese, including intentional differences from the approved mock): [docs/plan/UI刷新_2026-11-07.md](docs/plan/UI刷新_2026-11-07.md)
