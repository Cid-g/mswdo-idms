# Senior Citizen Registration — Complete Field List
**Pinagkunan:** Consolidated Masterlist ng Senior Citizens — Municipal Social Welfare and Development Office  
**Layunin:** Reference document para sa system development — lahat ng fields na kailangang i-encode, kasama ang paliwanag at mga valid na values

---

## Paano basahin ang dokumentong ito

Bawat field ay may:
- **Field Name** — pangalan ng field sa sistema
- **Paliwanag** — kung ano ang ibig sabihin at para saan ginagamit
- **Uri ng Input** — kung paano ito ipinasok (text, dropdown, date, atbp.)
- **Mga Valid na Value / Halimbawa** — kung may dropdown, lahat ng pagpipilian; kung free text, mga halimbawa mula sa totoong data

---

## GRUPO 1 — PERSONAL INFORMATION
*Basic na impormasyon tungkol sa senior citizen*

---

### 1. Last Name
**Paliwanag:** Apelyido ng senior citizen.  
**Uri:** Text  
**Halimbawa:** `Antonio`, `Delos Santos`, `Aguinaldo`

---

### 2. First Name
**Paliwanag:** Pangalan (first name) ng senior citizen.  
**Uri:** Text  
**Halimbawa:** `Warlito`, `Ofelia`, `Clemencia`

---

### 3. Middle Name
**Paliwanag:** Gitnang pangalan ng senior citizen. Maaaring blangko kung wala.  
**Uri:** Text  
**Halimbawa:** `Aguada`, `Castillo`, `Mata`

---

### 4. Barangay
**Paliwanag:** Ang barangay na tinitirhan ng senior citizen. Ginagamit sa lahat ng statistical reports at summary per barangay — ito ang batayan ng lahat ng counting at breakdown.  
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

### 5. Sex
**Paliwanag:** Kasarian ng senior citizen. Ginagamit sa lahat ng reports na may breakdown ng Male at Female.  
**Uri:** Dropdown  
**Mga Pagpipilian:** `M` (Male) · `F` (Female)

---

### 6. Age
**Paliwanag:** Kasalukuyang edad ng senior citizen. **Hindi ito manually ini-input** — awtomatikong kinukuha mula sa Birthday para laging tama.  
**Uri:** Number (auto-computed)  
**Nota:** I-compute palagi mula sa birthday gamit ang `DATEDIF` o katumbas na formula. Hindi dapat i-store bilang static na numero.

---

### 7. Birthday
**Paliwanag:** Petsa ng kapanganakan ng senior citizen. Ito ang pinagbabatayan ng automatic na pagkuha ng edad at para malaman kung karapat-dapat na ang isang tao bilang senior citizen (60 taong gulang pataas).  
**Uri:** Date  
**Format:** `MM/DD/YYYY`  
**Halimbawa:** `10/21/1945`, `12/22/1940`, `06/08/1959`

---

### 8. Marital Status
**Paliwanag:** Kasalukuyang katayuan sa pag-aasawa ng senior citizen.  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `Single` — hindi pa kasal
- `Married` — kasal
- `Widowed` — biyudo o biyuda
- `Separated` — hiwalay
- `Divorced` — diborsyado (kung applicable)

---

### 9. Contact Number
**Paliwanag:** Numero ng telepono ng senior citizen o ng kanilang kamag-anak/tagapag-alaga para sa pakikipag-ugnayan.  
**Uri:** Text (11-digit mobile number)  
**Halimbawa:** `09491207150`, `06151743`

---

### 10. Living Status
**Paliwanag:** Nagsasabi kung paano namumuhay ang senior citizen — kung nag-iisa, kasama ang pamilya, o nagpapaupa. Ginagamit para malaman kung may sapat na suporta ang senior citizen sa kanilang pang-araw-araw na buhay.  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `Owned` — sariling bahay
- `Rent` — nagpapaupa
- `Living Alone` — nag-iisa sa bahay
- `Living with Relatives` — kasama ang pamilya o kamag-anak

---

### 11. Occupation
**Paliwanag:** Trabaho o hanap-buhay ng senior citizen, kung mayroon. Marami sa mga senior citizen ay wala nang trabaho.  
**Uri:** Text (free text)  
**Mga Karaniwang Sagot:**
```
None / N/A     — walang trabaho
Farmer         — magsasaka
Vendor         — nagtitinda
Pensioner      — may pension na
Retired        — retired na
```

---

### 12. Income
**Paliwanag:** Buwanang kita ng senior citizen mula sa trabaho, pension, o ibang pinagkukunan.  
**Uri:** Number (free text sa Excel, dapat numeric sa system)  
**Halimbawa:** `5000`, `3000`, `N/A`

---

### 13. Medical Condition
**Paliwanag:** Mga sakit o kondisyong medikal na mayroon ang senior citizen. Ginagamit para malaman kung anong uri ng medikal na suporta ang kailangan.  
**Uri:** Text (free text, maaaring maraming sakit)  
**Halimbawa:** `Hypertension`, `Diabetes`, `Arthritis`, `Heart Disease`, `None`

---

### 14. Medicine
**Paliwanag:** Mga gamot na regular na iniinom ng senior citizen para sa kanilang mga kondisyon.  
**Uri:** Text (free text)  
**Halimbawa:** `Amlodipine`, `Metformin`, `None`

---

### 15. Disabled
**Paliwanag:** Nagpapatunay kung ang senior citizen ay mayroon ding kapansanan (PWD). Ang ilang senior citizen ay sabay na naka-register sa OSCA at sa PDAO.  
**Uri:** Yes/No o Text  
**Mga Pagpipilian:** `YES` · `NO`

---

## GRUPO 2 — OSCA ID INFORMATION
*Detalye ng Senior Citizen ID (OSCA Card)*

---

### 16. OSCA No.
**Paliwanag:** Opisyal na numero ng Senior Citizen ID (OSCA — Office for Senior Citizens' Affairs). Ito ang natatanging identifier ng bawat senior citizen sa sistema. Walang dalawang senior citizen ang may parehong OSCA number.  
**Uri:** Text  
**Format:** `YY-NNNN` (dalawang-digit na taon, dash, serial number)  
**Halimbawa:** `15-0666`, `17-0257`, `21-0575`, `22-1177`  
**Nota:** Ang prefix na `15`, `17`, `21`, `22` ay nagsasaad ng taon ng pagpaparehistro (2015, 2017, 2021, 2022)

---

### 17. RRN (Registry Reference Number)
**Paliwanag:** Ang RRN o Registry Reference Number ay isang karagdagang identifier na maaaring nagkokonekta sa national database o sa lokal na registry system. Opsyonal ito para sa ilang senior citizens.  
**Uri:** Text  
**Halimbawa:** `03-6906-000-XXXXXXX`

---

### 18. Date Issued
**Paliwanag:** Petsa kung kailan inilabas ang Senior Citizen ID. Ginagamit para malaman kung kailan nagparehistro ang senior citizen at para sa validity tracking.  
**Uri:** Date  
**Format:** `MM/DD/YYYY`  
**Halimbawa:** `06/14/2017`, `09/27/2021`, `10/20/2022`

---

### 19. Category
**Paliwanag:** Nagsasabi kung paano nagparehistro ang senior citizen — dumating ba sila mismo sa opisina (Walk-In), o nagpunta ang MSWD sa kanilang barangay (Caravan of Services). Ginagamit para sa tracking ng outreach activities at para malaman kung gaano karami ang naaabot ng bawat programa.  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `Walk-In` — pumunta mismo ang senior citizen sa munisipyo o opisina
- `Caravan` — nagpunta ang MSWD sa barangay para sa mass registration (Caravan of Services)

---

### 20. ID Status
**Paliwanag:** Nagsasabi kung ang kasalukuyang transaksyon ay para sa bagong ID, kapalit ng nawala/sira, o para sa transfer ng record. Iba ito sa kung bisa pa ba ang ID — ito ay tungkol sa uri ng transaksyon.  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `New` — bagong pagpaparehistro (first time)
- `Replace` — kapalit ng lumang ID na sira, nawala, o nag-expire
- `Loss` — ang ID ay nawala (lost ID transaction)
- `Transfer` — inilipat ang rekord mula sa ibang barangay o munisipyo

---

## GRUPO 3 — PENSION / BENEFITS INFORMATION
*Mga benepisyo at pension na tinatanggap ng senior citizen*

---

### 21. Pensioner (Yes/No)
**Paliwanag:** Simple na yes/no na nagpapatunay kung ang senior citizen ay mayroon na bang anumang uri ng pension mula sa gobyerno o pribadong institusyon.  
**Uri:** Dropdown  
**Mga Pagpipilian:** `Yes` · `No`

---

### 22. Pension (Type)
**Paliwanag:** Kung `Pensioner = Yes`, ito ang uri ng pension na tinatanggap. Mahalaga ito para malaman kung ang senior citizen ay dapat pang bigyan ng Social Pension (para sa mahihirap na senior na walang iba pang pension). Kung mayroon nang SSS o GSIS pension, hindi na sila kasali sa Social Pension.  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `socpen` — Social Pension (National) — mula sa DSWD para sa indigent seniors
- `local socpen` — Social Pension (Local) — mula sa lokal na pamahalaan
- `SSS` — retirement pension mula sa Social Security System
- `GSIS` — retirement pension mula sa Government Service Insurance System
- `PVAO` — pension mula sa Philippine Veterans Affairs Office
- `Socpen/SSS` — may parehong Social Pension at SSS
- `Transfer` — inilipat ang pension record mula sa ibang lugar
- `None / N/A` — walang pension

---

### 23. Pension Amount
**Paliwanag:** Ang halaga ng pension na tinatanggap bawat buwan o bawat quarter. Para sa Social Pension, ang halaga ay tinutukoy ng DSWD. Para sa SSS/GSIS, iba-iba ito depende sa kontribusyon.  
**Uri:** Number  
**Halimbawa:** `500` (per month para sa Social Pension), `3000`, `5000`

---

## GRUPO 4 — STATUS & REMARKS
*Kasalukuyang katayuan ng rekord*

---

### 24. Remarks
**Paliwanag:** Pangkalahatang katayuan o karagdagang tala tungkol sa senior citizen. Maaaring i-set nang mano-mano ng encoder o awtomatikong nagbabago batay sa ibang fields. Ginagamit din sa mga summary reports para sa pension categorization.  
**Uri:** Text / Dropdown  
**Mga Karaniwang Value:**
- `Active` — buhay at aktibo sa sistema
- `Deceased` — namatay na ang senior citizen
- `Transfer` — lumipat na sa ibang barangay o munisipyo
- Maaari ring gamitin ang uri ng pension dito sa ilang entry (tulad ng `socpen`, `local socpen`) — depende sa encoding practice ng opisina

---

### 25. ID Status (Living/Active Status)
**Paliwanag:** Kasalukuyang katayuan ng senior citizen sa sistema — buhay pa ba, namatay na, o lumipat na. Iba ito sa ID Status ng Grupo 2 na tungkol sa transaksyon. Ang field na ito ay tungkol sa buhay at katayuan ng tao.  
**Uri:** Dropdown  
**Mga Pagpipilian:**
- `Active` — buhay at nakatala sa kasalukuyang barangay
- `Deceased` — namatay na
- `Transferred` — lumipat na sa ibang lugar

---

## BUOD NG LAHAT NG FIELDS

| # | Field Name | Uri | Grupo |
|---|-----------|-----|-------|
| 1 | Last Name | Text | Personal |
| 2 | First Name | Text | Personal |
| 3 | Middle Name | Text | Personal |
| 4 | Barangay | Dropdown (44 options) | Personal |
| 5 | Sex | Dropdown (M/F) | Personal |
| 6 | Age | Number (auto-computed) | Personal |
| 7 | Birthday | Date | Personal |
| 8 | Marital Status | Dropdown | Personal |
| 9 | Contact Number | Text | Personal |
| 10 | Living Status | Dropdown | Personal |
| 11 | Occupation | Text | Personal |
| 12 | Income | Number | Personal |
| 13 | Medical Condition | Text | Health |
| 14 | Medicine | Text | Health |
| 15 | Disabled (PWD) | Yes/No | Health |
| 16 | OSCA No. | Text | ID |
| 17 | RRN | Text | ID |
| 18 | Date Issued | Date | ID |
| 19 | Category | Dropdown (Walk-In / Caravan) | ID |
| 20 | ID Status (Transaction Type) | Dropdown (New/Replace/Loss/Transfer) | ID |
| 21 | Pensioner (Yes/No) | Dropdown | Pension |
| 22 | Pension Type | Dropdown | Pension |
| 23 | Pension Amount | Number | Pension |
| 24 | Remarks | Text / Dropdown | Status |
| 25 | Living/Active Status | Dropdown | Status |

**Total: 25 fields** — 8 Dropdown, 8 Free Text, 3 Date/Number, 2 Yes/No, 1 Auto-computed

---

## PAGKAKAIBA MULA SA PWD SYSTEM

| | PWD | Senior Citizen |
|---|---|---|
| Primary ID | Control No. (`2024-461`) | OSCA No. (`15-0666`) |
| Secondary ID | PWD ID Number | RRN |
| Disability Field | Type of Disability (10 categories) | Disabled Yes/No only |
| Pension | Wala | May pension type at amount |
| Age Minimum | Wala (lahat ng edad) | 60 taong gulang pataas |
| Outreach Tracking | Uploaded to DOH / NAT / LOC | Caravan vs Walk-In category |
| Case Management | Services availed, needs, resources | Basic lang (medical condition, medicine) |

---

## MAHAHALAGANG TALA PARA SA DEVELOPER

**Auto-computed fields (huwag hayaang i-input ng user):**
- `Age` — laging i-compute mula sa Birthday, hindi i-store bilang static

**Dalawang field na parehong tinatawag na "ID Status" — dapat gawing malinaw:**
- **Transaction Type** (`New` / `Replace` / `Loss` / `Transfer`) — uri ng transaksyon ng ID
- **Living/Active Status** (`Active` / `Deceased` / `Transferred`) — buhay ba ang tao

**Pension logic para sa Social Pension eligibility:**
- Kung `Pension Type = SSS` o `GSIS` o `PVAO` → **hindi karapat-dapat** sa Social Pension
- Kung `Pension Type = None` at indigent → **karapat-dapat** sa Social Pension (National o Local)

**Pension values na kailangan i-normalize (inconsistency sa raw data):**
```
'socpen' at 'Socpen/SSS' at 'socpen/sss' → dapat istandarisa ang capitalization
'transfer' at 'Transfer' at 'transfer singat' → dapat istandarisa
'deceased' → dapat separate na Living Status field ito, hindi pension type
'SSS' at 'sss' → dapat istandarisa
```

**Category values mula sa summary sheets (Updating tab):**
- `Caravan` — ginagamit sa COUNTIFS formulas
- `Walk-In` — ginagamit sa COUNTIFS formulas
- Ang dalawang ito ang mga opisyal na values kahit ang Sheet4 ay `WALK-IN` lang ang nakalista

**Fields na ginagamit sa official reports:**
- `Barangay` + `Sex` → per barangay Male/Female count
- `Pension Type` (`socpen`, `local socpen`) → Social Pension beneficiaries count
- `Category` + `ID Status (Transaction)` → Caravan at Walk-In reports (New vs Replace)
- `Living Status` → Active senior citizen count

**Ang `OSCA No.` format:**
- `YY-NNNN` kung saan `YY` = taon ng pagpaparehistro
- Halimbawa: `15-0666` = nagrehistro noong 2015, ika-666 na registrant
- Ginagamit para malaman ang taon ng unang pagpaparehistro ng senior
