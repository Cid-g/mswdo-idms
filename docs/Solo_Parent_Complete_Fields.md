# Solo Parent Registration — Complete Field List
**Pinagkunan:** Gerona Database of Solo Parents (as of December 31, 2025)  
**Batas na Batayan:** Republic Act 8972 (Solo Parents' Welfare Act), DILG MC 2023-140  
**Layunin:** Reference document para sa system development — lahat ng fields na kailangang i-encode, kasama ang paliwanag at mga valid na values

---

## Paano basahin ang dokumentong ito

Bawat field ay may:
- **Field Name** — pangalan ng field sa sistema
- **Paliwanag** — kung ano ang ibig sabihin at para saan ginagamit
- **Uri ng Input** — kung paano ito ipinasok (text, dropdown, date, atbp.)
- **Mga Valid na Value / Halimbawa** — kung may dropdown, lahat ng pagpipilian; kung free text, mga halimbawa

---

## GRUPO 1 — RECORD IDENTIFICATION
*Mga field na nagpapakilala sa bawat rekord*

---

### 1. PSGC Code
**Paliwanag:** 10-digit na Philippine Standard Geographic Code ng munisipyo. Ito ang opisyal na code ng gobyerno para sa Gerona, Tarlac na ginagamit sa national database at reporting sa DSWD.  
**Uri:** Text (fixed value para sa Gerona)  
**Halimbawa:** `0306906000`  
**Nota:** Laging `0306906000` para sa Gerona — hindi na kailangang baguhin

---

### 2. Case Number
**Paliwanag:** Natatanging numero ng rekord ng bawat solo parent. Ginagamit para sa paghahanap, pag-refer, at para sa SPIC number generation. Ang format ay batay sa taon at buwan ng pagpaparehistro.  
**Uri:** Text (system-generated)  
**Format:** `YYMM-NNNNNN` — dalawang-digit na taon, dalawang-digit na buwan, dash, 6-digit na sunod-sunod na numero  
**Halimbawa:** `2501-000001` (Enero 2025, unang registrant), `2501-000002`, `2412-000099`

---

### 3. PhilSys Card Number (PCN)
**Paliwanag:** Numero ng PhilSys ID (national ID) ng solo parent. Ginagamit para sa national identity verification. Kung wala pang PhilSys ID, isusulat na `N/A`.  
**Uri:** Text  
**Format:** `NNNN-NNNN-NNNN-NNNN` (16-digit)  
**Halimbawa:** `4859-3649-8371-8415`, `N/A`

---

## GRUPO 2 — PERSONAL INFORMATION
*Basic na impormasyon tungkol sa solo parent*

---

### 4. Last Name
**Paliwanag:** Apelyido ng solo parent.  
**Uri:** Text  
**Halimbawa:** `Agustin`, `Tabayoyong`, `Dulay`

---

### 5. First Name
**Paliwanag:** Pangalan (first name) ng solo parent.  
**Uri:** Text  
**Halimbawa:** `Mary Jane`, `Venus`, `Dimple`

---

### 6. Middle Name
**Paliwanag:** Gitnang pangalan ng solo parent. Maaaring blangko kung wala.  
**Uri:** Text  
**Halimbawa:** `Romero`, `Sabado`, `Ular`

---

### 7. Extension Name
**Paliwanag:** Karagdagan sa pangalan tulad ng Jr., Sr., II, III. Hindi lahat ay may extension name.  
**Uri:** Text (optional)  
**Halimbawa:** `Jr.`, `Sr.`, `II`

---

### 8. Birthdate
**Paliwanag:** Petsa ng kapanganakan ng solo parent. Ginagamit para sa automatic na pagkuha ng edad.  
**Uri:** Date  
**Format:** `MM/DD/YYYY`  
**Halimbawa:** `05/02/1983`, `01/24/1983`, `09/18/1979`

---

### 9. Age
**Paliwanag:** Kasalukuyang edad ng solo parent. **Auto-computed** — hindi manually ini-input, kinukuha mula sa Birthdate.  
**Uri:** Number (auto-computed)

---

### 10. Civil Status
**Paliwanag:** Kasalukuyang katayuan sa pag-aasawa ng solo parent. Mahalaga ito dahil direktang konektado ito sa Category Code bilang solo parent (halimbawa, widow/er ay kategoryang a2).  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `Single` — hindi pa kasal, nagpalaki ng bata nang walang asawa
- `Married` — kasal pa pero de facto separated (asawa ay OFW, naka-kulungan, may kapansanan, atbp.)
- `Widow/er` — namatay ang asawa
- `Annulled` — may annulment na

---

### 11. Sex
**Paliwanag:** Kasarian ng solo parent.  
**Uri:** Dropdown  
**Mga Pagpipilian:** `Male` · `Female`

---

### 12. Educational Attainment
**Paliwanag:** Pinakamataas na antas ng pag-aaral na natapos ng solo parent. Ginagamit para malaman ang educational profile at para sa programa at livelihood referrals.  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `No Education` — walang pinag-aralan
- `Elementary Level` — nakapag-aral sa elementarya pero hindi nagtapos
- `Elementary Graduate` — nagtapos ng elementarya
- `High School Level` — nakapag-aral sa hayskul pero hindi nagtapos
- `High School Graduate` — nagtapos ng hayskul
- `Vocational / TVET` — technical-vocational course
- `College Level` — nakapag-aral sa kolehiyo pero hindi nagtapos
- `College Graduate` — nagtapos ng kolehiyo

---

### 13. Religion
**Paliwanag:** Relihiyon ng solo parent.  
**Uri:** Text (free text)  
**Halimbawa:** `Catholic`, `Born Again`, `Iglesia ni Cristo`, `Islam`

---

### 14. Employment Status
**Paliwanag:** Kasalukuyang katayuan sa trabaho ng solo parent. Ginagamit para malaman kung anong uri ng suporta ang kailangan.  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `Employed (Public or Private)` — may regular na trabaho sa gobyerno o pribadong kompanya
- `Self-employed` — sariling negosyo o freelance
- `Not Employed` — walang trabaho

---

### 15. Occupation / Work
**Paliwanag:** Tiyak na trabaho o hanapbuhay ng solo parent. Mas detalyado kaysa sa Employment Status.  
**Uri:** Text (free text)  
**Halimbawa:** `Laundrywoman`, `Teacher`, `Office Staff`, `Farmer`, `Vendor`, `None`

---

### 16. Monthly Income
**Paliwanag:** Bracket ng buwanang kita ng solo parent. Ginagamit para malaman ang antas ng kahirapan at para sa eligibility sa iba't ibang programa.  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `No income` — walang kita
- `minimum wage and below` — kumikita ng minimum wage o mas mababa (Tarlac minimum wage ≈ Php 500–540/day)
- `(minimum wage +1) to Php 20833` — nasa gitna ng kita
- `Php 20834 and above` — mas mataas na kita

---

## GRUPO 3 — CHILDREN / DEPENDENTS INFORMATION
*Impormasyon tungkol sa mga anak o dependent ng solo parent*

---

### 17. No. of Children (0–6 years old)
**Paliwanag:** Bilang ng anak o dependent na may edad 0 hanggang 6 taong gulang. Ginagamit para malaman kung may maliliit na bata na nangangailangan ng espesyal na atensyon.  
**Uri:** Number  
**Halimbawa:** `0`, `1`, `2`

---

### 18. No. of Children (7–22 years old)
**Paliwanag:** Bilang ng anak o dependent na may edad 7 hanggang 22 taong gulang. Ang grupong ito ay maaaring nag-aaral pa at nangangailangan ng educational support.  
**Uri:** Number  
**Halimbawa:** `0`, `1`, `2`, `3`

---

### 19. No. of Children (Above 22, with Special Needs — WSN)
**Paliwanag:** Bilang ng anak na lagpas 22 taong gulang ngunit may espesyal na pangangailangan (may kapansanan o may kondisyon na nangangailangan ng patuloy na pag-aalaga). Sila ay kasama pa rin sa bilang ng mga dependent.  
**Uri:** Number  
**Halimbawa:** `0`, `1`

---

### 20–25. Children / Dependents (per child)
**Paliwanag:** Detalyadong impormasyon ng bawat anak o dependent. Para sa **bawat anak ay may sariling hanay (row)**  — kung maraming anak, ginagamit ang susunod na linya nang walang uulitin ang impormasyon ng solo parent.  

Ang mga sub-fields para sa **bawat anak** ay:

| Sub-field | Paliwanag | Uri |
|-----------|-----------|-----|
| **Last Name ng Anak** | Apelyido | Text |
| **First Name ng Anak** | Pangalan | Text |
| **Middle Name ng Anak** | Gitnang pangalan | Text |
| **Birthdate ng Anak** | Kaarawan, format `MM/DD/YYYY` | Date |
| **Sex ng Anak** | Kasarian | Dropdown: `Male` · `Female` |
| **Relationship to Solo Parent** | Relasyon sa solo parent | Text (karaniwang `Parent` = anak ng solo parent) |

**Halimbawa ng multi-child entry:**
```
Row 1: Case 2501-000001 | Solo Parent: Agustin, Mary Jane | Child: Agustin, Jay Louise (Female, 03/31/2006)
Row 2: (walang case number) | Child: Agustin, Jenica (Female, 12/12/2011)
```

---

## GRUPO 4 — SOLO PARENT CLASSIFICATION
*Kategorya at ID ng solo parent batay sa batas*

---

### 26. Category Code as Solo Parent
**Paliwanag:** Opisyal na kategorya ng solo parent batay sa **DILG MC 2023-140** (at RA 8972). Ito ang pinakamahalagang field para sa legal classification — tinutukoy nito kung **bakit** solo parent ang isang tao. Ginagamit para sa reports at eligibility sa mga benepisyo.  
**Uri:** Dropdown  
**Mga Pagpipilian (lahat ng kategorya):**

| Code | Kategorya | Paliwanag |
|------|-----------|-----------|
| `a1` | Consequence of Rape | Ang solo parent ay naging ina dahil sa panggagahasa |
| `a2` | Widow/Widower | Namatay ang asawa |
| `a3` | Spouse of PDL | Ang asawa ay Person Deprived of Liberty (naka-kulungan) |
| `a4` | Spouse of PWD | Ang asawa ay may kapansanan at hindi makapag-trabaho |
| `a5` | Separated or de facto separated | Hiwalay sa asawa, may legal separation o de facto (kahit walang legal na dokumento) |
| `a6` | Annulled | May annulment na |
| `a7` | Abandoned (Abandonment of Spouse) | Inabandona ng asawa |
| `b`  | Spouse/Relative of OFW | Ang asawa ay Overseas Filipino Worker at nag-iisang nag-aalaga ng mga bata |
| `c`  | Unmarried person | Hindi kasal pero may anak na pinaalagaan |
| `d`  | Legal Guardian, Adoptive or Foster Parent | Legal guardian o adoptive/foster parent na nag-iisang nag-aalaga |
| `e`  | Relative | Kamag-anak na nag-aalaga ng bata dahil patay o wala ang mga magulang |
| `f`  | Pregnant woman | Buntis at walang asawa o mag-aalaga |

---

### 27. Solo Parent Identification Card Number (SPIC)
**Paliwanag:** Opisyal na numero ng Solo Parent ID Card. Ito ang primary identifier ng solo parent sa national at local na sistema. Natatangi ito sa bawat solo parent at naka-base sa PSGC code at Case Number.  
**Uri:** Text (system-generated)  
**Format:** `PSGCCODE-CASENUMBER` (PSGC nang walang leading zeros + dash + case number)  
**Halimbawa:** `036906000-2501-000001`, `036906000-2501-000002`

---

### 28. Date SPIC Issued
**Paliwanag:** Petsa kung kailan inilabas ang Solo Parent ID Card.  
**Uri:** Date  
**Format:** `MM/DD/YYYY`  
**Halimbawa:** `01/10/2025`, `01/13/2025`

---

### 29. Status
**Paliwanag:** Nagsasabi kung ang kasalukuyang transaksyon ay bagong pagpaparehistro o pag-renew ng ID. Ginagamit para sa annual tracking ng New vs Renewal per barangay.  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `New` — unang beses na nagpaparehistro bilang solo parent
- `Renewal` — nag-re-renew ng Solo Parent ID (karaniwan ay taon-taon)

---

## GRUPO 5 — ADDRESS INFORMATION
*Tirahan ng solo parent*

---

### 30. No. / Street
**Paliwanag:** Numero ng bahay at pangalan ng kalye o purok.  
**Uri:** Text  
**Halimbawa:** `Pisung`, `Bukang Liwayway`, `123 Rizal St.`

---

### 31. Barangay
**Paliwanag:** Barangay ng tirahan ng solo parent. Ito ang pangunahing geographic unit para sa lahat ng reports.  
**Uri:** Dropdown  
**44 Barangays (parehong barangay sa PWD at Senior Citizen):**
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

### 32. Municipality / City
**Paliwanag:** Pangalan ng munisipyo. Fixed value para sa lahat ng rekord sa sistemang ito.  
**Uri:** Text (fixed)  
**Value:** `Gerona`

---

### 33. Province
**Paliwanag:** Lalawigan.  
**Uri:** Text (fixed)  
**Value:** `Tarlac`

---

### 34. Region
**Paliwanag:** Rehiyon.  
**Uri:** Text (fixed)  
**Value:** `III` (Region III — Central Luzon)

---

### 35. Contact Number
**Paliwanag:** Mobile number ng solo parent para sa pakikipag-ugnayan.  
**Uri:** Text  
**Halimbawa:** `09671087699`, `09652612241`

---

### 36. Email Address
**Paliwanag:** Email address ng solo parent. Optional — hindi lahat ay may email.  
**Uri:** Text (optional)  
**Halimbawa:** `maryjane@gmail.com`, `N/A`

---

## GRUPO 6 — SPECIAL CLASSIFICATIONS
*Karagdagang kategorya ng solo parent*

---

### 37. Pantawid Beneficiary
**Paliwanag:** Nagsasabi kung ang solo parent ay kasali sa **4Ps (Pantawid Pamilyang Pilipino Program)** — ang conditional cash transfer program ng DSWD para sa mahihirap na pamilya.  
**Uri:** Dropdown  
**Mga Pagpipilian:** `Y` (Yes) · `N` (No)

---

### 38. Indigenous Person (IP)
**Paliwanag:** Nagsasabi kung ang solo parent ay miyembro ng isang Indigenous People group (katutubong komunidad). Kung oo, isusulat ang pangalan ng tribal affiliation. Kung hindi, `No`.  
**Uri:** Text  
**Mga Pagpipilian:** `No` o pangalan ng tribo (halimbawa: `Ibaloi`, `Aeta`, `Igorot`)

---

### 39. LGBTQ+
**Paliwanag:** Nagsasabi kung ang solo parent ay miyembro ng LGBTQ+ community. Ginagamit para sa inclusive na pag-uulat at programa.  
**Uri:** Dropdown  
**Mga Pagpipilian:** `Y` (Yes) · `No`

---

### 40. PWD (Person with Disability)
**Paliwanag:** Nagsasabi kung ang solo parent mismo ay may kapansanan. Kung oo, maaari silang naka-register din sa PDAO. Ito ay tungkol sa solo parent — hindi sa kanilang anak.  
**Uri:** Dropdown  
**Mga Pagpipilian:** `Yes` · `No`

---

### 41. Senior Citizen *(para sa FO Template)*
**Paliwanag:** Nagsasabi kung ang solo parent ay 60 taong gulang pataas — naka-qualify rin bilang Senior Citizen. Maaari silang naka-register din sa OSCA.  
**Uri:** Yes/No  
**Mga Pagpipilian:** `Y` · `N`

---

## GRUPO 7 — ASSISTANCE / SERVICES *(para sa FO Template)*
*Mga serbisyo at tulong na natanggap — ginagamit ng Field Office ng DSWD*

> Ang grupong ito ay **hindi** bahagi ng basic registration sa LGU. Ginagamit ito ng **DSWD Field Office** para sa case management at assistance tracking.

---

### 42. Mode of Admission
**Paliwanag:** Paano nakarating ang solo parent sa opisina para humingi ng tulong. Ginagamit para malaman kung paano naaabot ng serbisyo ang mga kliyente.  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `Walk-in` — pumunta mismo sa opisina
- `Phone call` — tumawag sa telepono
- `Email` — nagpadala ng email
- `Referral` — ni-refer ng ibang ahensya o tao

---

### 43. ComBased Assistance
*(Community-Based Assistance)*  
**Paliwanag:** Uri ng tulong na ibinigay sa loob ng komunidad (hindi AICS). Kasama ang petsa, uri ng tulong, at halaga.  
**Uri:** Structured (Date + Classification + Amount)  
**Mga Klasipikasyon ng Tulong:**
```
Medical       — gamot, ospital, medikal na gastos
Financial     — pera para sa pangunahing pangangailangan
Educational   — school fees, school supplies
Funeral       — gastos sa libing
Hygiene Kit   — personal hygiene products
Food          — pagkain o relief goods
Material      — construction materials, household items
Transportation — pamasahe o sasakyan
```

---

### 44. AICS Referral
*(Assistance to Individuals in Crisis Situation)*  
**Paliwanag:** Tulong na ibinibigay ng DSWD sa mga indibidwal na nasa krisis. Kasama ang petsa, uri ng tulong, at halaga.  
**Uri:** Structured (Date + Classification + Amount)  
**Mga Klasipikasyon:** Parehong mga kategorya ng ComBased Assistance sa itaas

---

### 45. Psychosocial Services
**Paliwanag:** Mga serbisyong psychological at social na ibinigay — counseling, therapy, support groups. Kasama ang petsa at mga tala.  
**Uri:** Text (Date + Remarks)

---

### 46. Referral to Other Services / Agencies
**Paliwanag:** Kung ni-refer ang solo parent sa ibang ahensya para sa karagdagang tulong — halimbawa, TESDA para sa livelihood training, DOLE para sa trabaho, atbp.  
**Uri:** Text (Date + Name of Agency)  
**Halimbawa:** `Endorsed to TESDA for skills training program evaluation`

---

### 47. Remarks
**Paliwanag:** Karagdagang tala tungkol sa rekord o katayuan ng solo parent — maaaring tungkol sa mga hinaing, problema sa pagpaparehistro, o iba pang impormasyon.  
**Uri:** Text (free text)  
**Halimbawa:** `incomplete requirements`, `no intake & requirements`, `no requirements`

---

## BUOD NG LAHAT NG FIELDS

### LGU Registration Fields (para sa MSWD encoding)

| # | Field Name | Uri | Grupo |
|---|-----------|-----|-------|
| 1 | PSGC Code | Text (fixed: 0306906000) | Record ID |
| 2 | Case Number | Text (auto-generated) | Record ID |
| 3 | PhilSys Card Number (PCN) | Text | Record ID |
| 4 | Last Name | Text | Personal |
| 5 | First Name | Text | Personal |
| 6 | Middle Name | Text | Personal |
| 7 | Extension Name | Text (optional) | Personal |
| 8 | Birthdate | Date | Personal |
| 9 | Age | Number (auto-computed) | Personal |
| 10 | Civil Status | Dropdown (4 options) | Personal |
| 11 | Sex | Dropdown (Male/Female) | Personal |
| 12 | Educational Attainment | Dropdown (8 options) | Personal |
| 13 | Religion | Text | Personal |
| 14 | Employment Status | Dropdown (3 options) | Personal |
| 15 | Occupation / Work | Text | Personal |
| 16 | Monthly Income | Dropdown (4 brackets) | Personal |
| 17 | No. of Children (0–6 yrs) | Number | Children |
| 18 | No. of Children (7–22 yrs) | Number | Children |
| 19 | No. of Children (22+ WSN) | Number | Children |
| 20 | Child Last Name | Text | Children |
| 21 | Child First Name | Text | Children |
| 22 | Child Middle Name | Text | Children |
| 23 | Child Birthdate | Date | Children |
| 24 | Child Sex | Dropdown (M/F) | Children |
| 25 | Child Relationship to Solo Parent | Text | Children |
| 26 | Category Code (Solo Parent) | Dropdown (12 categories) | Classification |
| 27 | SPIC Number | Text (auto-generated) | ID |
| 28 | Date SPIC Issued | Date | ID |
| 29 | Status | Dropdown (New/Renewal) | ID |
| 30 | No. / Street | Text | Address |
| 31 | Barangay | Dropdown (44 options) | Address |
| 32 | Municipality | Text (fixed: Gerona) | Address |
| 33 | Province | Text (fixed: Tarlac) | Address |
| 34 | Region | Text (fixed: III) | Address |
| 35 | Contact Number | Text | Contact |
| 36 | Email Address | Text (optional) | Contact |
| 37 | Pantawid Beneficiary | Dropdown (Y/N) | Classification |
| 38 | Indigenous Person | Text (Y or tribal name) | Classification |
| 39 | LGBTQ+ | Dropdown (Y/No) | Classification |
| 40 | PWD | Dropdown (Yes/No) | Classification |

### Additional FO (Field Office) Fields

| # | Field Name | Uri | Grupo |
|---|-----------|-----|-------|
| 41 | Senior Citizen | Yes/No | Classification |
| 42 | Mode of Admission | Dropdown (4 options) | Services |
| 43 | ComBased Assistance (Date + Type + Amount) | Structured | Services |
| 44 | AICS Referral (Date + Type + Amount) | Structured | Services |
| 45 | Psychosocial Services (Date + Remarks) | Text | Services |
| 46 | Referral to Other Agencies (Date + Agency) | Text | Services |
| 47 | Remarks | Text | Status |

**Total: 47 fields** — 14 Dropdown, 16 Text, 4 Date, 3 Number, 4 Auto-generated, 3 Fixed, 3 Structured

---

## NATATANGING KATANGIAN NG SOLO PARENT SYSTEM

### Multi-child na Rekord
Ang bawat solo parent ay maaaring may maraming anak. Para sa **bawat karagdagang anak**, ginagamit ang **bagong row** sa Excel — ang impormasyon ng solo parent ay hindi na uulitin, ang mga fields ng anak (cols 20–25) lang ang puputukan.

**Sa database:** dapat gamitin ang **one-to-many relationship** — isang solo parent ay maaaring may maraming child records.

### SPIC Number Generation
```
SPIC = (PSGC nang walang leading zeros) + "-" + Case Number
Halimbawa: 036906000 + "-" + 2501-000001 = 036906000-2501-000001
```

### Case Number Format
```
Format: YYMM-NNNNNN
YY   = dalawang-digit na taon (25 = 2025)
MM   = dalawang-digit na buwan (01 = Enero)
NNNN = 6-digit na sequence number na nagpapatuloy bawat buwan
Halimbawa: 2501-000001, 2501-000002, 2502-000001 (bagong buwan)
```

---

## PAGKAKAIBA MULA SA PWD AT SENIOR CITIZEN

| | PWD | Senior Citizen | Solo Parent |
|---|---|---|---|
| Primary ID | Control No. | OSCA No. | SPIC No. |
| Secondary ID | PWD ID No. | RRN | PCN (PhilSys) |
| Min. Qualification | Kapansanan | 60 taong gulang | Mag-iisang nag-aalaga ng bata |
| Key Classification | Uri ng Kapansanan (10 types) | Pension Type | Category Code (12 categories, batay sa RA 8972) |
| National Reference | — | DOH System | DILG MC 2023-140 |
| Children's Info | Hindi kasama | Hindi kasama | **Kasama** (bawat anak, may sariling row) |
| Assistance Tracking | Basic lang | Basic lang | **Detalyado** (ComBased, AICS, Psychosocial, Referral) |
| Validity | 2 taon (ID) | Buhay | Taon-taon (renewal) |

---

## MAHAHALAGANG TALA PARA SA DEVELOPER

**Auto-computed / system-generated fields:**
- `Age` — laging i-compute mula sa Birthdate
- `Case Number` — auto-generated, format `YYMM-NNNNNN`
- `SPIC Number` — auto-generated mula sa PSGC Code + Case Number

**Fixed fields (hindi na kailangang i-input ng user):**
- `PSGC Code` = `0306906000`
- `Municipality` = `Gerona`
- `Province` = `Tarlac`
- `Region` = `III`

**Multi-child na arkitektura:**
- Sa database, ang children ay dapat nasa **hiwalay na collection/table** na may `parent_id` na nag-re-refer sa solo parent record
- Ang child record ay may: last_name, first_name, middle_name, birthdate, sex, relationship

**Category Code inconsistency sa raw data (kailangan i-normalize):**
- `a2. Widow/Widower` at `a2. Widow/widower` → dapat istandarisa ang capitalization
- `a7. Abandonment of Spouse` at `a7. Abandoned` → gumamit ng opisyal na label mula sa DILG MC 2023-140

**Pantawid / LGBTQ+ / IP values (kailangan i-normalize):**
- `Y`, `Yes`, `N`, `No` → dapat consistent, gumamit ng Boolean
