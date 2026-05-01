# Embryo Selection App — Project Summary

## Overview

A web application for a reproductive medicine clinic that helps patients select a donor embryo. The app provides a personalized, structured, and transparent decision-making experience — reducing uncertainty for patients while keeping the process medically controlled by doctors.

---

## Target Users

- Couples diagnosed with infertility
- Patients after failed IVF cycles
- Single women seeking donor embryos
- Couples with genetic risk factors

---

## Access Flow

Access is not self-registered. A doctor:
1. Reviews the patient's case and curates a pool of compatible embryos
2. Generates a unique, time-limited, patient-bound link
3. Sends the link via email or messenger

The patient follows the link and lands directly in their personalized catalog.

---

## Core User Scenarios

| # | Scenario | Description |
|---|----------|-------------|
| 0 | Access | Doctor creates a selection and sends a unique link to the patient |
| 1 | Browse & Filter | Patient filters by donor eye color, height, ethnicity, genetics; views cards; saves favorites |
| 2 | Risk Review | Patient opens an embryo card and reviews genetic screening results and donor medical data |
| 3 | Submit Request | Patient selects an embryo and submits an inquiry to the clinic |
| 4 | Get Help | Patient chats with a coordinator or books a consultation |

---

## MVP Features

1. **Embryo Card** — donor info, embryo info, genetic screening results, embryo photo
2. **Catalog** — list of embryo cards with filters
3. **Favorites & Comparison** — save and compare 2–3 embryos side by side
4. **Request Form** — name, contact details, selected embryo → sent to CRM
5. **Support Chat** — patient ↔ coordinator

---

## Data Model (Embryo Object)

Each embryo record contains:

- **Basic info**: status (`available`/`reserved`), creation date, clinic ID
- **Egg donor**: age, blood type, education, ethnicity, height, eye color, hair color
- **Sperm donor**: same fields
- **Predicted phenotype**: eye color, hair color, height range, skin tone
- **Genetics**: screening status, chromosomal abnormalities flag, risk factors (name + level)
- **Medical**: embryo quality grade (A/B/C), development stage (blastocyst etc.), freeze date
- **Matching**: compatible blood types, notes
- **Media**: embryo image, donor photo availability flag
- **Meta**: reservation expiry, priority score

---

## Role Model

| Role | Capabilities | Hidden from patients |
|------|-------------|----------------------|
| **Patient** | Browse catalog, filter, view cards, favorite, submit request, chat | Embryo sex, sensitive medical data, internal IDs |
| **Doctor / Coordinator** | Everything patient can + create selections, generate links, receive requests, reply in chat, view analytics, see hidden fields (sex, extended genetics) | — |
| **Admin** | Everything doctor can + manage embryo/donor data, change embryo status, access logs and metrics | — |

---

## Authorization

- Access is granted via a doctor-generated link
- Links are time-limited and bound to a specific patient

---

## Non-Functional Requirements

- **Logging**: embryo views, filter usage, favorites actions, form submissions
- **Analytics**: most-used filters, most-viewed embryos, drop-off points in the funnel
- **Language**: Russian UI (required by Russian consumer and state language law)
- **Branding**: UI follows the corporate style of [ibioclinic.com](https://ibioclinic.com/)
- **Compliance**:
  - Explicit user consent before personal data form submission
  - Privacy policy must be published on the site
  - Cookie usage notification required
  - Disclaimer that app content is not a medical conclusion
