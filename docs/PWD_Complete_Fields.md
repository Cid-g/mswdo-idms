# PWD Registration — Complete Field List
**Pinagkunan:** PDAO Excel Database ng Municipal Social Welfare and Development Office  
**Layunin:** Reference document para sa system development — lahat ng fields na kailangang i-encode, kasama ang paliwanag at mga valid na values

---

## Paano basahin ang dokumentong ito

Bawat field ay may:
- **Field Name** — pangalan ng field sa system
- **Paliwanag** — kung ano ang ibig sabihin at kung para saan
- **Uri ng Input** — kung paano ito ipinasok (text, dropdown, date, atbp.)
- **Mga Valid na Value / Halimbawa** — kung may dropdown, lahat ng pagpipilian; kung free text, mga halimbawa mula sa totoong data

---

## GRUPO 1 — RECORD IDENTIFICATION
*Mga field na nagpapakilala sa bawat rekord sa sistema*

---

### 1. Control Number
**Paliwanag:** Natatanging numero ng rekord ng bawat PWD. Ito ang pangunahing identifier ng bawat tao sa sistema. Ginagamit din ito para sa paghahanap at pag-refer sa rekord.  
**Uri:** Text (system-generated)  
**Format:** `YYYY-###` — taon ng pagpaparehistro, dash, sunod-sunod na numero  
**Halimbawa:** `2024-461`, `2023-114`, `2025-275`

---

### 2. Type of Client
**Paliwanag:** Nagsasabi kung ang PWD ay bagong nagparehistro, nagre-renew ng ID, o namatay na. Ginagamit ito para malaman kung ilan ang bago at ilan ang nag-renew sa isang taon.  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `New` — unang beses na nagpaparehistro
- `Renew` — nagre-renew ng nag-expire na ID
- `Deceased` — namatay na, naka-record para sa history

---

## GRUPO 2 — PERSONAL INFORMATION
*Basic na impormasyon tungkol sa PWD*

---

### 3. Last Name
**Paliwanag:** Apelyido ng PWD.  
**Uri:** Text  
**Halimbawa:** `Adaoag`, `Dela Cruz`, `Reyes`

---

### 4. Given Name
**Paliwanag:** Pangalan (first name) ng PWD.  
**Uri:** Text  
**Halimbawa:** `Jeorge`, `Maria`, `Juan`

---

### 5. Middle Name
**Paliwanag:** Gitnang pangalan ng PWD. Maaaring blangko kung wala.  
**Uri:** Text  
**Halimbawa:** `Parazo`, `Santos`

---

### 6. Extension Name (EXT.)
**Paliwanag:** Karagdagan sa pangalan, tulad ng Jr. o Sr. Hindi lahat ay may extension name.  
**Uri:** Dropdown (optional)  
**Mga Pagpipilian:** `JR.` · `SR.` · `II` · `III`

---

### 7. Purok / Street
**Paliwanag:** Eksaktong tirahan ng PWD sa loob ng barangay — ang pangalan ng purok o kalye.  
**Uri:** Text  
**Halimbawa:** `Purok Mazuri`, `Purok Payapa`, `Bukang Liwayway`

---

### 8. Barangay
**Paliwanag:** Ang barangay na tinitirhan ng PWD. Ginagamit ito para sa lahat ng statistical reports at summary per barangay.  
**Uri:** Dropdown  
**44 Barangays:**
```
Abagon        Amacalan      Apsayan       Ayson
Bawa          Buenlag       Bularit       Calayaan
Carbonel      Cardona       Caturay       Danzo
Dicolor       Don Basilio   Luna          Mabini
Magaspac      Malayep       Matapitap     Matayuncab
New Salem     Oloybuaya     Padapada      Parsolingan
Pinasling     Plastado      Poblacion 1   Poblacion 2
Poblacion 3   Quezon        Rizal         Salapungan
San Agustin   San Antonio   San Bartolome San Jose
Sta. Lucia    Santiago      Sembrano      Singat
Sulipa        Tagumbao      Tangcaran     Villa Paz
```

---

### 9. Date of Birth
**Paliwanag:** Kaarawan ng PWD. Ginagamit para automatic na makuha ang edad at para sa age segregation reports.  
**Uri:** Date  
**Format:** `MM/DD/YYYY`  
**Halimbawa:** `10/07/1976`, `11/12/2018`

---

### 10. Age
**Paliwanag:** Kasalukuyang edad ng PWD. **Hindi ito manually ini-input** — awtomatikong kinukuha mula sa Date of Birth para laging tama.  
**Uri:** Number (auto-computed)  
**Nota:** Dapat laging i-compute mula sa birthdate, hindi i-store bilang static na numero

---

### 11. Sex
**Paliwanag:** Kasarian ng PWD. Ginagamit sa lahat ng reports na may breakdown ng Male at Female.  
**Uri:** Dropdown  
**Mga Pagpipilian:** `M` (Male) · `F` (Female)

---

### 12. Civil Status
**Paliwanag:** Kasalukuyang katayuan sa pag-aasawa ng PWD.  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `Single` — hindi pa kasal
- `Married` — kasal
- `Separated` — hiwalay
- `Widow/er` — biyudo o biyuda
- `Cohabilitation` — nagsasama nang walang kasal

---

### 13. Relationship to Household Head
**Paliwanag:** Ang relasyon ng PWD sa pinuno ng kanilang pamilya o bahay. Ginagamit para malaman ang household composition ng mga PWD.  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `Household Head` — siya mismo ang ulo ng pamilya
- `Spouse` — asawa ng household head
- `Son/Daughter` — anak
- `Brother/Sister` — kapatid
- `Son-in-Law/Daughter-in-Law` — manugang
- `Grandson/Granddaughter` — apo
- `Father/Mother` — magulang
- `Other Relative` — ibang kamag-anak

---

### 14. Contact Number
**Paliwanag:** Numero ng telepono ng PWD o ng kanilang kamag-anak/guardian para sa pakikipag-ugnayan.  
**Uri:** Text (11-digit mobile number)  
**Halimbawa:** `09491207150`, `09568537209`

---

### 15. Religion
**Paliwanag:** Relihiyon ng PWD. Optional na field.  
**Uri:** Text (free text)  
**Halimbawa:** `Catholic`, `Born Again`, `Iglesia ni Cristo`

---

## GRUPO 3 — DISABILITY INFORMATION
*Detalye tungkol sa uri at dahilan ng kapansanan*

---

### 16. Type of Disability
**Paliwanag:** Ang opisyal na kategorya ng kapansanan ng PWD batay sa batas. Ito ang pinakamahalagang field para sa lahat ng disability type reports at summary tables. Isang tao ay may isang pangunahing kategorya.  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `1. Deaf or Hard of Hearing` — pagkabingi o kahirapan sa pakikinig
- `2. Intellectual Disability` — kapansanan sa isip/pag-iisip
- `3. Learning Disability` — kahirapan sa pag-aaral (dyslexia, atbp.)
- `4. Mental Disability` — mental health conditions
- `5. Physical Disability (Orthopedic)` — kapansanan sa katawan/kilos
- `6. Psychosocial Disability` — kapansanan na nakaapekto sa sosyal na pakikipag-ugnayan
- `7. Speech and Language Impairment` — kahirapan sa pagsasalita o wika
- `8. Visual Disability` — kapansanan sa paningin
- `9. Cancer (R.A. 11215)` — ayon sa Republic Act 11215
- `10. Rare Disease (R.A. 10747)` — ayon sa Republic Act 10747

---

### 17. Cause of Disability
**Paliwanag:** Kung paano o bakit nagkaroon ng kapansanan ang PWD. Mahalaga ito para sa pananaliksik at programa ng gobyerno.  
**Uri:** Text (free text, may mga karaniwang sagot)  
**Mga Karaniwang Sagot:**
```
Congenital / Congenital/Inborn   — ipinanganak na may kapansanan
Inborn                           — katulad ng Congenital
Acquired                         — nakuha pagkatapos ipanganak
Accident / Injury                — aksidente o sugat
Chronic Illness                  — matagalang sakit
Stroke                           — atake sa utak
Diabetes                         — komplikasyon ng diabetes
Down Syndrome                    — genetic condition
ADHD                             — Attention Deficit Hyperactivity Disorder
ASD                              — Autism Spectrum Disorder
Cleft Palate                     — bukong-palad
Seizure                          — epilepsy o atake
Aneurysm                         — pagputok ng ugat sa utak
Wrong Vaccine                    — masamang reaksyon sa bakuna
None / N/A                       — hindi tinukoy
```

---

## GRUPO 4 — EDUCATIONAL & LIVELIHOOD INFORMATION
*Edukasyon at kabuhayan ng PWD*

---

### 18. Educational Attainment
**Paliwanag:** Pinakamataas na antas ng pag-aaral na natapos ng PWD. Ginagamit para malaman ang educational profile ng mga PWD sa bawat barangay.  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `None` — walang pinag-aralan
- `Kinder` — kindergarten
- `Elem. Level` — nakapag-aral sa elementarya pero hindi nagtapos
- `Elem. Grad` — nagtapos ng elementarya
- `H.S. Level` — nakapag-aral sa hayskul pero hindi nagtapos
- `H.S. Grad.` — nagtapos ng hayskul
- `JR. H.S.` — Grade 7–10 (K-12)
- `SR. H.S.` — Grade 11–12 (K-12)
- `College Level` — nakapag-aral sa kolehiyo pero hindi nagtapos
- `College Grad.` — nagtapos ng kolehiyo
- `Vocational` — nag-aral ng vocational/technical course
- `Post Graduate` — master's o doctorate
- `SPED` — Special Education

---

### 19. Educational Status
**Paliwanag:** Kasalukuyang katayuan sa pag-aaral — kung nag-aaral pa ba o hindi. Iba ito sa Educational Attainment na nagtatapos na antas.  
**Uri:** Text (free text)  
**Mga Karaniwang Sagot:**
```
OSY        — Out of School Youth (hindi na nag-aaral)
ISY        — In School Youth (kasalukuyang nag-aaral)
IS         — In School
Student    — nag-aaral
Grade 1 hanggang Grade 12   — specific grade level
1st yr. College / 2nd Year College   — college year
Daycare    — nasa daycare pa
SPED       — special education program
```

---

### 20. Occupation
**Paliwanag:** Trabaho o hanap-buhay ng PWD. Mahalaga para malaman kung productibo ang PWD at kung anong uri ng trabaho ang kayang gawin.  
**Uri:** Text (free text)  
**Mga Karaniwang Sagot:**
```
None / N/A       — walang trabaho
Unemployed       — walang trabaho
Employed         — may trabaho
Self-Employed    — sariling negosyo
Laborer          — manggagawa
Factory Worker   — pabrika
Gov't Employee   — empleyado ng gobyerno
Student          — nag-aaral
Teacher          — guro
Professionals    — propesyonal
```

---

### 21. Monthly Income
**Paliwanag:** Buwanang kita ng PWD mula sa trabaho o iba pang pinagkukunan. Ginagamit para malaman ang economic status.  
**Uri:** Number (free text sa Excel, ideally numeric sa system)  
**Halimbawa:** `5000`, `15000`, `N/A`, `Php400/day`

---

### 22. Available Skill
**Paliwanag:** Mga kasanayan o talento ng PWD na maaaring gamitin sa kabuhayan o trabaho.  
**Uri:** Text (free text)  
**Halimbawa:** `Carpentry`, `Baking`, `Sewing`, `Computer Skills`

---

### 23. Skills / Livelihood / Seminar Desired
**Paliwanag:** Mga gustong matutunan ng PWD — training, livelihood program, o seminar na nais nilang pag-aralan. Ginagamit ng MSWD para mag-plano ng mga programa.  
**Uri:** Text (free text)  
**Halimbawa:** `Baking seminar`, `Livelihood training`, `Computer literacy`

---

### 24. Organization
**Paliwanag:** Pangalan ng PWD organization o samahan na kinabibilangan ng PWD. Optional.  
**Uri:** Text (free text)  
**Halimbawa:** `PDAO Abagon Chapter`, `PWD Federation`

---

### 25. Hobbies
**Paliwanag:** Libangan o aktibidad ng PWD sa kanilang libreng oras.  
**Uri:** Text (free text)  
**Halimbawa:** `Baking`, `Gardening`, `Reading`, `Drawing`

---

## GRUPO 5 — ID REGISTRATION INFORMATION
*Detalye ng PWD ID card*

---

### 26. ID Number
**Paliwanag:** Opisyal na numero ng PWD ID card na ibinibigay ng gobyerno. Natatangi ito sa bawat tao at hindi maaaring gamitin ng iba.  
**Uri:** Text  
**Format:** `NN-NNNN-NNN-NNNNNNN` (batay sa PhilSys o lokal na format)  
**Halimbawa:** `03-6906-000-0002533`, `03-6906-000-0001120`

---

### 27. Date Issued / Date Applied
**Paliwanag:** Petsa kung kailan inilabas ang PWD ID, o kung kailan nag-apply ang PWD. Ginagamit para kalkulahin kung expired na ang ID.  
**Uri:** Date  
**Format:** `MM/DD/YYYY`  
**Halimbawa:** `12/19/2024`, `06/14/2023`

---

### 28. Date (Expiry Date)
**Paliwanag:** Petsa ng pag-expire ng PWD ID. Pagkatapos ng 2 taon mula sa issuance, expired na ang ID at kailangan nang i-renew.  
**Uri:** Date  
**Format:** `MM/DD/YYYY`  
**Nota:** Sa Excel, madalas itong katumbas ng Date Issued — ang 2-year rule ay kinukuha sa pamamagitan ng Years field

---

### 29. Years
**Paliwanag:** Ilang taon na ang nakalipas mula nang mailabas ang ID. **Auto-computed** — hindi manually ini-input. Ginagamit para malaman kung expired na ang ID (kapag higit sa 2 taon).  
**Uri:** Number (auto-computed)  
**Formula:** `Taon ngayon - Taon ng issuance`

---

### 30. ID Status
**Paliwanag:** Kasalukuyang katayuan ng PWD ID — bisa pa o expired na. **Awtomatikong kinukuha** batay sa bilang ng taon mula nang mailabas.  
**Uri:** Text (auto-computed)  
**Mga Value:**
- `Updated` — valid pa ang ID (hindi pa lagpas 2 taon)
- `Expired` — kailangan nang i-renew (lagpas na 2 taon)
- `Deceased` — namatay na ang may-ari

---

### 31. Remarks
**Paliwanag:** Katayuan ng PWD sa sistema. **Awtomatikong kinukuha** batay sa ID Status, pero maaaring i-override para sa espesyal na sitwasyon.  
**Uri:** Text (auto-computed, maaaring i-override)  
**Mga Value:**
- `Active` — buhay at valid ang ID
- `In-Active` — expired ang ID
- `Deceased` — namatay na
- `Transferred-Out` — lumipat na sa ibang lugar

---

## GRUPO 6 — SYSTEM / UPLOAD STATUS
*Tracking kung na-upload na sa iba pang sistema*

---

### 32. Uploaded to DOH System
**Paliwanag:** Nagpapatunay kung na-upload na ang rekord ng PWD sa national database ng Department of Health (DOH). Kinakailangan para sa national reporting.  
**Uri:** Boolean (Yes/No)  
**Mga Value:** `YES` · `NO`

---

### 33. NAT (National Form – Hardcopy)
**Paliwanag:** Nagpapatunay kung naisumite na ang pisikal na kopya ng national form sa DOH o sa higher office. Kailangan ng parehong digital at physical record.  
**Uri:** Boolean (Yes/No)  
**Mga Value:** `YES` · `NO`

---

### 34. LOC (Local Form)
**Paliwanag:** Nagpapatunay kung naisumite na ang lokal na form sa munisipyo. Separate ito sa national form.  
**Uri:** Boolean (Yes/No)  
**Mga Value:** `YES` · `NO`

---

## GRUPO 7 — SERVICES & CASE MANAGEMENT
*Mga serbisyo at pangangailangan ng PWD — ginagamit ng social worker*

---

### 35. Services Availed in the Government (Local and National) / Date
**Paliwanag:** Listahan ng mga serbisyong natanggap ng PWD mula sa gobyerno — lokal man o pambansa — kasama ang petsa. Halimbawa: PhilHealth, 4Ps, ayuda, atbp. Ginagamit ng social worker para malaman kung anong tulong na ang natanggap.  
**Uri:** Text (free text, maaaring mahabang sagot)  
**Halimbawa:** `4Ps Beneficiary - 2022`, `PhilHealth - 2023`, `DSWD Ayuda - April 2024`

---

### 36. Needs / Problems Facing as a Person with Disability
**Paliwanag:** Mga pangangailangan at problemang kinakaharap ng PWD sa kanilang pang-araw-araw na buhay. Ito ang pinaka-narrative na field — sinusulat ng social worker ang kalagayan ng PWD. Ginagamit para mag-plano ng mga programa at intervensyon.  
**Uri:** Text (free text, maaaring mahabang sagot)  
**Halimbawa:** `Needs wheelchair`, `Needs financial assistance`, `Needs therapy`

---

### 37. Other Family Resources
**Paliwanag:** Iba pang pinagkukunan ng tulong o suporta ng pamilya ng PWD — maaaring ibang miyembro ng pamilya na nagtatrabaho, o ibang benepisyo na tinatanggap.  
**Uri:** Text (free text)  
**Halimbawa:** `Spouse working abroad`, `Sibling supports financially`, `Pensioner parent`

---

## BUOD NG LAHAT NG FIELDS

| # | Field Name | Uri | Grupo |
|---|-----------|-----|-------|
| 1 | Control Number | Text (auto-generated) | Record ID |
| 2 | Type of Client | Dropdown | Record ID |
| 3 | Last Name | Text | Personal |
| 4 | Given Name | Text | Personal |
| 5 | Middle Name | Text | Personal |
| 6 | Extension Name | Dropdown | Personal |
| 7 | Purok / Street | Text | Personal |
| 8 | Barangay | Dropdown (44 options) | Personal |
| 9 | Date of Birth | Date | Personal |
| 10 | Age | Number (auto) | Personal |
| 11 | Sex | Dropdown | Personal |
| 12 | Civil Status | Dropdown | Personal |
| 13 | Relationship to HH Head | Dropdown | Personal |
| 14 | Contact Number | Text | Personal |
| 15 | Religion | Text | Personal |
| 16 | Type of Disability | Dropdown (10 options) | Disability |
| 17 | Cause of Disability | Text | Disability |
| 18 | Educational Attainment | Dropdown (13 options) | Education |
| 19 | Educational Status | Text | Education |
| 20 | Occupation | Text | Livelihood |
| 21 | Monthly Income | Number/Text | Livelihood |
| 22 | Available Skill | Text | Livelihood |
| 23 | Skills / Livelihood / Seminar Desired | Text | Livelihood |
| 24 | Organization | Text | Livelihood |
| 25 | Hobbies | Text | Personal |
| 26 | ID Number | Text | ID |
| 27 | Date Issued / Date Applied | Date | ID |
| 28 | Expiry Date | Date | ID |
| 29 | Years (since issuance) | Number (auto) | ID |
| 30 | ID Status | Text (auto-computed) | ID |
| 31 | Remarks / Client Status | Text (auto-computed) | ID |
| 32 | Uploaded to DOH System | Yes/No | System |
| 33 | NAT – National Form (Hardcopy) | Yes/No | System |
| 34 | LOC – Local Form | Yes/No | System |
| 35 | Services Availed | Text (narrative) | Services |
| 36 | Needs / Problems | Text (narrative) | Services |
| 37 | Other Family Resources | Text (narrative) | Services |

**Total: 37 fields** — 15 Dropdown, 13 Free Text, 4 Date/Number, 3 Yes/No, 2 Auto-computed

---

## MAHAHALAGANG TALA PARA SA DEVELOPER

**Auto-computed fields (huwag hayaang i-input ng user):**
- `Age` — laging i-compute mula sa Date of Birth
- `Years` — bilang ng taon mula sa Date Issued
- `ID Status` — kung `Years > 2`, Expired; kung hindi, Updated
- `Remarks` — kung `ID Status = Updated`, Active; kung hindi, In-Active

**Fields na may data quality issues sa Excel (kailangang i-clean sa system):**
- `Type of Client` — may inconsistency: `New`, `new`, `Renew`, `REnew`, `Renewal` — dapat istandarisa
- `Uploaded` — may `YES`, `Yes`, `yes`, `yES` — dapat Boolean lang
- `Income` — may `N/A`, `n/A`, `NA`, mixed text at number — dapat structured
- `Educational Status` — may mga mali-mali ang nalagay (tulad ng ID number sa field na ito)

**Fields na ginagamit sa official reports:**
- `Barangay` + `Type of Disability` + `Sex` — para sa Summary of PWD per Barangay
- `Age` + `Sex` — para sa Age Segregation Report
- `ID Status` — para sa Updated/Expired counts
- `Type of Client` — para sa New/Renew counts per barangay
- `Uploaded to DOH`, `NAT`, `LOC` — para sa compliance tracking
