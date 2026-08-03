# Priority Fields for ID Generation — Quick Encoding Flow
**Para sa:** ID Management System — MSWD Gerona, Tarlac  
**Layunin:** Dahil maraming pila, i-encode muna ang pinakamahalagang fields para makapag-generate agad ng ID card, saka na lang kukumpletuhin ang buong profile

---

## Paano gumagana ang dalawang-hakbang na pag-encode

```
STEP 1 — QUICK ENCODE (para sa ID generation)
  ↓ i-encode ang minimum required fields
  ↓ i-generate ang ID card (front + back)
  ↓ maibibigay na sa citizen

STEP 2 — COMPLETE PROFILE (saka na, sa susunod na visit o habang naghihintay)
  ↓ kumpletuhin ang natitirang fields
  ↓ para sa reporting, programs, at case management
```

---

## PWD ID CARD

### 📋 FRONT ng PWD ID — Fields na kailangan

Batay sa actual na layout ng ID card:

| # | Field sa ID | Field Name sa Database | Halimbawa |
|---|------------|----------------------|-----------|
| 1 | **NAME** | `last_name` + `given_name` + `middle_name` | `EDWIN BAGAIN MAGDAY` |
| 2 | **ADDRESS** | `barangay` + `municipality` + `province` | `AMACALAN, GERONA, TARLAC` |
| 3 | **DATE OF BIRTH** | `birthdate` | `10-19-1970` |
| 4 | **TYPE OF DISABILITY** | `type_of_disability` | `CANCER (RA11215)` |
| 5 | **DATE OF ISSUE** | `date_issued` (auto: today) | `MAY 05, 2026` |
| 6 | **ID NO.** | `id_number` (auto-generated) | `03-6906-000-0002975` |
| 7 | **PHOTO** | `photo` (upload) | 2x2 photo |
| 8 | **SIGNATURE** | `signature` (capture/upload) | pirma o thumbmark |

### 📋 BACK ng PWD ID — Fields na kailangan

| # | Field sa ID | Field Name sa Database | Halimbawa |
|---|------------|----------------------|-----------|
| 1 | **IN CASE OF EMERGENCY — NAME** | `emergency_contact_name` | `MYRNA B. MENDIOLA` |
| 2 | **IN CASE OF EMERGENCY — CONTACT** | `emergency_contact_number` | `0995-431-8318` |

> **Nota:** Ang text sa likod (benefits, valid for 5 years, mayor's signature) ay **static** — hindi na kailangang i-encode, naka-print na sa template.

### ✅ PWD Quick Encode — Minimum Fields (10 fields lang)

```
1. Last Name               (required)
2. First Name              (required)
3. Middle Name             (optional, pero karaniwang may middle name)
4. Barangay                (required — dropdown)
5. Date of Birth           (required)
6. Type of Disability      (required — dropdown, 10 options)
7. Photo                   (required — upload)
8. Signature               (required — capture o upload)
9. Emergency Contact Name  (required)
10. Emergency Contact No.  (required)

→ AUTO-GENERATED: ID Number, Date of Issue
```

---

## SENIOR CITIZEN ID CARD

### 📋 FRONT ng Senior ID — Fields na kailangan

| # | Field sa ID | Field Name sa Database | Halimbawa |
|---|------------|----------------------|-----------|
| 1 | **ID NO.** | `osca_no` (auto-generated) | `26-0501` |
| 2 | **NAME** | `last_name` + `middle_name` + `given_name` | `GERARDA NEBRIA TERRIBLE` |
| 3 | **ADDRESS** | `barangay` + municipality | `AMACALAN, GERONA, TARLAC` |
| 4 | **DATE OF BIRTH** | `birthdate` | `04-23-1966` |
| 5 | **AGE** | `age` (auto-computed) | `60` |
| 6 | **DATE OF ISSUE** | `date_issued` (auto: today) | `MAY 11, 2026` |
| 7 | **PHOTO** | `photo` (upload) | 2x2 photo |
| 8 | **SIGNATURE** | `signature` (capture/upload) | pirma o thumbmark |

### 📋 BACK ng Senior ID
> Puro **static text** — benefits list at mga pangalan ng OSCA Head at Mayor. Walang variable na kailangang i-encode.

### ✅ Senior Citizen Quick Encode — Minimum Fields (6 fields lang)

```
1. Last Name               (required)
2. First Name              (required)
3. Middle Name             (optional)
4. Barangay                (required — dropdown)
5. Date of Birth           (required → auto-computes Age)
6. Photo                   (required — upload)
7. Signature               (required — capture o upload)

→ AUTO-GENERATED: OSCA No., Date of Issue, Age
```

> **Pinakamaikli sa tatlo** — 6 fields lang ang kailangan para makapag-print ng Senior Citizen ID.

---

## SOLO PARENT ID CARD

### 📋 FRONT ng Solo Parent ID — Fields na kailangan

| # | Field sa ID | Field Name sa Database | Halimbawa |
|---|------------|----------------------|-----------|
| 1 | **ID No.** | `spic_number` (auto-generated) | `0306906000-2605-000001` |
| 2 | **NAME** | `last_name` + `first_name` + `middle_name` | `MARIA DIVINA BUAN DE JESUS` |
| 3 | **Date and Place of Birth** | `birthdate` + `birthplace` | `06-06-1967 / CALOOCAN CITY` |
| 4 | **Address** | `barangay` + municipality + province | `POBLACION 1 GERONA, TARLAC` |
| 5 | **Solo Parent Category** | `category_code` | `a2` |
| 6 | **Benefit Qualification Code** | `benefit_code` | *(mula sa kategorya)* |
| 7 | **Valid until** | `date_expiry` (auto: +2 years) | `MAY 04, 2027` |
| 8 | **PHOTO** | `photo` (upload) | 2x2 photo |
| 9 | **Signature or thumbprint** | `signature` (capture/upload) | pirma o thumbmark |

### 📋 BACK ng Solo Parent ID — Fields na kailangan

| # | Field sa ID | Field Name sa Database | Halimbawa |
|---|------------|----------------------|-----------|
| 1 | **Child Name** | `child[].full_name` | `ARVIN DAVE A. CASICA` |
| 2 | **Child Date of Birth** | `child[].birthdate` | `08-23-2009` |
| 3 | **Child Age** | `child[].age` (auto-computed) | `16` |
| 4 | **Child Relationship** | `child[].relationship` | `SON` |
| 5 | **Emergency Contact Name** | `emergency_contact_name` | `SHIELA MAE CADIENTE` |
| 6 | **Emergency Contact Address** | `emergency_contact_address` | `PANIQUI, TARLAC` |
| 7 | **Emergency Contact Number** | `emergency_contact_number` | `0909-082-9387` |

> Ang talahanayan sa likod ay may **6 na puwesto para sa mga anak** — kung kulang, blank lang ang natitirang rows.

### ✅ Solo Parent Quick Encode — Minimum Fields (pinaka-marami sa tatlo)

```
PERSONAL INFO:
1. Last Name               (required)
2. First Name              (required)
3. Middle Name             (optional)
4. Birthdate               (required)
5. Birthplace              (required — para sa front ng ID)
6. Barangay                (required — dropdown)
7. Category Code           (required — dropdown, 12 options)

CHILDREN (at least 1):
8.  Child Full Name        (required — bawat anak)
9.  Child Birthdate        (required — para makuha ang age)
10. Child Relationship     (required — SON / DAUGHTER / etc.)

EMERGENCY CONTACT:
11. Emergency Contact Name    (required)
12. Emergency Contact Address (required)
13. Emergency Contact Number  (required)

PHOTO & SIGNATURE:
14. Photo                  (required — upload)
15. Signature              (required — capture o upload)

→ AUTO-GENERATED: SPIC Number, Date of Issue, Expiry Date (+2 years), Child Ages
```

---

## SIDE-BY-SIDE COMPARISON — Quick Encode Fields

| Field | PWD | Senior | Solo Parent |
|-------|:---:|:------:|:-----------:|
| Last Name | ✅ | ✅ | ✅ |
| First Name | ✅ | ✅ | ✅ |
| Middle Name | ✅ | ✅ | ✅ |
| Birthdate | ✅ | ✅ | ✅ |
| Birthplace | ❌ | ❌ | ✅ |
| Barangay | ✅ | ✅ | ✅ |
| Type of Disability | ✅ | ❌ | ❌ |
| Solo Parent Category | ❌ | ❌ | ✅ |
| Photo | ✅ | ✅ | ✅ |
| Signature | ✅ | ✅ | ✅ |
| Emergency Contact Name | ✅ | ❌ | ✅ |
| Emergency Contact Number | ✅ | ❌ | ✅ |
| Emergency Contact Address | ❌ | ❌ | ✅ |
| Children Info (per child) | ❌ | ❌ | ✅ |
| **TOTAL MINIMUM FIELDS** | **10** | **6** | **15+** |

---

## FIELDS NA PARA SA STEP 2 LANG (hindi kailangan para sa ID)

### PWD — Ikukumpleto pagkatapos
```
Civil Status               Rel. to Household Head
Sex                        Educational Attainment
Educational Status         Occupation
Income                     Religion
Hobbies                    Organization
Available Skill            Skills/Livelihood Desired
Services Availed           Needs/Problems
Other Family Resources     Uploaded to DOH
NAT Form submitted         LOC Form submitted
```

### Senior Citizen — Ikukumpleto pagkatapos
```
Sex                        Marital Status
Pensioner (Y/N)            Pension Type
Pension Amount             Living Status
Occupation                 Income
Medical Condition          Medicine
Disabled (Y/N)             RRN
Category (Walk-In/Caravan) ID Status (New/Replace)
```

### Solo Parent — Ikukumpleto pagkatapos
```
Sex                        Civil Status
Educational Attainment     Employment Status
Occupation                 Monthly Income
Religion                   PhilSys Card Number (PCN)
Pantawid Beneficiary       Indigenous Person
LGBTQ+                     PWD
Senior Citizen             Email Address
Benefit Qualification Code Mode of Admission
ComBased Assistance        AICS Referral
Psychosocial Services      Referral to other Agencies
```

---

## STATIC FIELDS SA ID (naka-print na, hindi kailangan i-encode)

### PWD ID (Back)
- "THE HOLDER OF THIS CARD IS A PERSON WITH DISABILITY AND IS ENTITLED TO..."
- "ANY VIOLATION THEREOF IS PUNISHABLE BY LAW"
- "THIS CARD IS NON-TRANSFERABLE. VALID FOR 5 YEARS."
- Mayor's name at signature
- "Republic of the Philippines, Province of Tarlac, Municipality of Gerona"

### Senior Citizen ID (Back)
- Benefits list (FREE medical, 20% discounts, etc.)
- "Benefits Under Republic Act No. 9994"
- OSCA Head name at signature
- Mayor's name at signature

### Solo Parent ID (Back)
- MSWDO Head name at signature (Ethel B. Oclaray, RSW)
- Mayor's name at signature
- Table headers: NAME / DATE OF BIRTH / AGE / RELATIONSHIP

---

## NOTES PARA SA DEVELOPER

**ID Number Formats:**
```
PWD:         03-6906-000-XXXXXXX  (format mula sa PhilHealth/DOH system)
Senior:      YY-NNNN              (e.g., 26-0501 = taong 2026, ika-501)
Solo Parent: 0306906000-YYMM-NNNNNN
```

**Auto-generated sa sistema (hindi manual na input):**
```
PWD:         ID Number, Date of Issue
Senior:      OSCA No., Date of Issue, Age
Solo Parent: SPIC Number, Date of Issue, Expiry Date (+2 yrs), Child Ages
```

**Photo at Signature:**
- Dapat may webcam capture o file upload na option
- Minimum resolution: 2x2 inches, 150 DPI
- Format: JPG o PNG
- Kailangan bago makapag-print ng ID

**Validity ng bawat ID:**
```
PWD:         5 taon (VALID FOR 5 YEARS)
Senior:      Walang expiry na nakalagay (buhay ay valid)
Solo Parent: 2 taon mula sa date of issue (MAY 04, 2027 = +2 yrs)
```

**Children sa Solo Parent ID (back):**
- May **6 rows** sa talahanayan — puwede hanggang 6 na anak
- Kung lalampas sa 6, ilalagay na lang ang una at pinaka-bata (depende sa opisina)
- Age ay auto-computed mula sa birthdate ng anak
