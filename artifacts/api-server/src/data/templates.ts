import { LegalTemplate } from '../types';

export const legalTemplates: LegalTemplate[] = [
  {
    id: 'slp-supreme-court',
    name: 'Special Leave Petition (Supreme Court)',
    category: 'Supreme Court',
    description: 'Special Leave Petition under Article 136 of Constitution to Supreme Court against High Court Judgment',
    content: `# **IN THE SUPREME COURT OF INDIA**

## **CIVIL APPELLATE JURISDICTION**

### **SPECIAL LEAVE PETITION (CIVIL) UNDER ARTICLE 136 OF THE CONSTITUTION OF INDIA**

**IN THE MATTER OF:**

**{{petitionerName}}**
{{petitionerAddress}}
...Petitioner

**VERSUS**

**{{respondentName}}**
{{respondentAddress}}
...Respondent

---

## **SYNOPSIS**

{{synopsis}}

---

## **LIST OF DATES**

{{listOfDates}}

---

### **SPECIAL LEAVE PETITION UNDER ARTICLE 136 OF THE CONSTITUTION OF INDIA**

**TO,**

**THE HON'BLE CHIEF JUSTICE OF INDIA**
**AND HIS COMPANION JUDGES OF THE**
**SUPREME COURT OF INDIA**

The humble petition of the petitioner above named.

## **MOST RESPECTFULLY SHEWETH:**

1. That the present petition has been filed under Article 136 of the Constitution of India praying for grant of special leave to appeal against the judgment and decree dated {{judgmentDate}} passed by the {{highCourtName}} in {{caseTitle}} ({{caseNumber}}).

2. That the facts of the case are as follows:
   [Detailed facts to be filled]

3. That the impugned judgment suffers from the following errors:
   [Grounds of appeal to be filled]

4. That the present petition raises substantial questions of law as to the interpretation of the Constitution.

5. That in the facts and circumstances of the case, the petitioner is entitled to the relief prayed for.

## **PRAYER**

For the reasons stated above, it is most respectfully prayed that this Hon'ble Court may be pleased to:

- a) Grant special leave to file the present petition;
- b) Set aside the impugned judgment and decree;
- c) Pass such other orders as this Hon'ble Court may deem fit and proper;

**AND FOR THIS ACT OF KINDNESS, THE PETITIONER AS IN DUTY BOUND, SHALL EVER PRAY.**

**{{petitionerName}}**
Petitioner

**Filed by:**

**{{aorName}}**
Advocate on Record for the Petitioner
AOR Code: {{aorCode}}
{{aorAddress}}
Phone: {{aorPhone}}

Dated: {{date}}
Place: New Delhi`,
    fields: [
      { id: 'petitionerName', name: 'Petitioner Name', type: 'text', placeholder: 'Enter petitioner name', required: true },
      { id: 'petitionerAddress', name: 'Petitioner Address', type: 'textarea', placeholder: 'Full address of petitioner', required: true },
      { id: 'respondentName', name: 'Respondent Name', type: 'text', placeholder: 'Enter respondent name', required: true },
      { id: 'respondentAddress', name: 'Respondent Address', type: 'textarea', placeholder: 'Full address of respondent', required: true },
      { id: 'synopsis', name: 'Synopsis', type: 'textarea', placeholder: 'Brief summary of the case and grounds for seeking leave', required: true },
      { id: 'listOfDates', name: 'List of Dates', type: 'textarea', placeholder: 'Chronological list of key dates and events e.g.\n01.01.2023 - Suit filed\n15.06.2023 - Trial court judgment\n10.01.2024 - High Court dismissed appeal', required: true },
      { id: 'judgmentDate', name: 'Judgment Date', type: 'date', required: true },
      { id: 'highCourtName', name: 'High Court Name', type: 'text', placeholder: 'e.g. High Court of Delhi', required: true },
      { id: 'caseTitle', name: 'Case Title', type: 'text', placeholder: 'Enter case title', required: true },
      { id: 'caseNumber', name: 'Case Number', type: 'text', placeholder: 'Enter case number', required: true },
      { id: 'aorName', name: 'Advocate on Record (AOR) Name', type: 'text', placeholder: 'Name of AOR', required: true },
      { id: 'aorCode', name: 'AOR Code', type: 'text', placeholder: 'e.g. R-123', required: true },
      { id: 'aorAddress', name: 'AOR Office Address', type: 'textarea', placeholder: 'Chamber address, Supreme Court of India', required: true },
      { id: 'aorPhone', name: 'AOR Phone', type: 'text', placeholder: 'Contact number', required: true },
      { id: 'date', name: 'Date', type: 'date', required: true },
    ]
  },
  {
    id: 'bail-application',
    name: 'Bail Application',
    category: 'Criminal',
    description: 'Application for bail under Section 480/483 BNSS (formerly Section 437/439 CrPC)',
    content: `# **IN THE COURT OF {{courtName}}**

## **STATE THROUGH {{policeStation}}**
...Complainant

**VERSUS**

**{{accusedName}}**
...Accused

### **APPLICATION UNDER SECTION {{section}} FOR GRANT OF BAIL**

## **MOST RESPECTFULLY SUBMITTED:**

1. That the applicant/accused is in custody in connection with FIR No. {{firNumber}} dated {{firDate}} registered at Police Station {{policeStation}} for the offence punishable under Section(s) {{offenceSections}}.

2. That the applicant is innocent and has been falsely implicated in the present case.

3. That the applicant has permanent residence at {{address}} and is not likely to flee from justice.

4. That the applicant is ready and willing to cooperate with the investigation and shall not tamper with the evidence or influence the witnesses.

5. That the applicant has no criminal antecedents and there are reasonable grounds for believing that he is not guilty of the alleged offence.

6. That the investigation is already complete and charge sheet has been filed/not filed.

7. That the applicant is not required for any custodial interrogation and no useful purpose will be served by keeping him in further detention.

8. That the applicant undertakes to appear before this Hon'ble Court as and when directed.

## **PRAYER**

In view of the above, it is most respectfully prayed that this Hon'ble Court may be pleased to:

- a) Grant bail to the applicant/accused in FIR No. {{firNumber}};
- b) Pass such other orders as this Hon'ble Court may deem fit and proper.

**APPLICANT/ACCUSED**

**{{advocateName}}**
Advocate for the Applicant

Dated: {{date}}`,
    fields: [
      { id: 'courtName', name: 'Court Name', type: 'text', placeholder: 'Enter court name', required: true },
      { id: 'policeStation', name: 'Police Station', type: 'text', placeholder: 'Enter police station', required: true },
      { id: 'accusedName', name: 'Accused Name', type: 'text', placeholder: 'Enter accused name', required: true },
      { id: 'section', name: 'Bail Section', type: 'select', options: ['480 BNSS (formerly 437 CrPC)', '483 BNSS (formerly 439 CrPC)', '437 CrPC (pre-July 2024 cases)', '439 CrPC (pre-July 2024 cases)'], required: true },
      { id: 'firNumber', name: 'FIR Number', type: 'text', placeholder: 'Enter FIR number', required: true },
      { id: 'firDate', name: 'FIR Date', type: 'date', required: true },
      { id: 'offenceSections', name: 'Offence Sections (BNS/IPC)', type: 'text', placeholder: 'e.g. 303(2) BNS or 420/468 IPC', required: true },
      { id: 'address', name: 'Address', type: 'textarea', placeholder: 'Enter permanent address', required: true },
      { id: 'advocateName', name: 'Advocate Name', type: 'text', placeholder: 'Enter advocate name', required: true },
      { id: 'date', name: 'Date', type: 'date', required: true }
    ]
  },
  {
    id: 'civil-suit',
    name: 'Civil Suit',
    category: 'Civil',
    description: 'Plaint for recovery of money/performance of contract',
    content: `# **IN THE COURT OF {{civilJudgeName}}**

**{{courtAddress}}**

## **SUIT NO. {{suitNumber}} OF {{year}}**

**{{plaintiffName}}**
...Plaintiff

**VERSUS**

**{{defendantName}}**
...Defendant

### **SUIT FOR {{suitType}}**

## **MOST RESPECTFULLY SUBMITTED:**

1. That the plaintiff is a company/individual carrying on business at {{plaintiffAddress}} and is competent to file the present suit.

2. That the defendant is residing/carrying on business at {{defendantAddress}} and is liable to be sued in this court.

3. That the cause of action arose at {{causeOfActionPlace}} on {{causeOfActionDate}} when the defendant {{breachDetails}}.

4. That the defendant is liable to pay the plaintiff a sum of ₹{{amount}} on account of {{paymentReason}}.

5. That despite repeated demands, the defendant has failed to pay the said amount.

6. That the present suit is within time and this court has jurisdiction to try the same.

7. That the valuation of the suit for purposes of jurisdiction and court fees is ₹{{suitValue}}.

## **PRAYER**

In view of the above, it is most respectfully prayed that this Hon'ble Court may be pleased to:

- a) Pass a decree for recovery of ₹{{amount}} with interest;
- b) Grant costs of the suit;
- c) Pass such other orders as this Hon'ble Court may deem fit and proper.

**PLAINTIFF**

**{{advocateName}}**
Advocate for the Plaintiff

Dated: {{date}}`,
    fields: [
      { id: 'civilJudgeName', name: 'Civil Judge Name', type: 'text', placeholder: 'Enter judge designation', required: true },
      { id: 'courtAddress', name: 'Court Address', type: 'textarea', placeholder: 'Enter court address', required: true },
      { id: 'suitNumber', name: 'Suit Number', type: 'text', placeholder: 'Enter suit number', required: true },
      { id: 'year', name: 'Year', type: 'number', placeholder: 'Enter year', required: true },
      { id: 'plaintiffName', name: 'Plaintiff Name', type: 'text', placeholder: 'Enter plaintiff name', required: true },
      { id: 'defendantName', name: 'Defendant Name', type: 'text', placeholder: 'Enter defendant name', required: true },
      { id: 'suitType', name: 'Suit Type', type: 'text', placeholder: 'Enter suit type', required: true },
      { id: 'plaintiffAddress', name: 'Plaintiff Address', type: 'textarea', placeholder: 'Enter plaintiff address', required: true },
      { id: 'defendantAddress', name: 'Defendant Address', type: 'textarea', placeholder: 'Enter defendant address', required: true },
      { id: 'causeOfActionPlace', name: 'Cause of Action Place', type: 'text', placeholder: 'Enter place', required: true },
      { id: 'causeOfActionDate', name: 'Cause of Action Date', type: 'date', required: true },
      { id: 'breachDetails', name: 'Breach Details', type: 'textarea', placeholder: 'Enter breach details', required: true },
      { id: 'amount', name: 'Amount', type: 'number', placeholder: 'Enter amount', required: true },
      { id: 'paymentReason', name: 'Payment Reason', type: 'text', placeholder: 'Enter payment reason', required: true },
      { id: 'suitValue', name: 'Suit Value', type: 'number', placeholder: 'Enter suit value', required: true },
      { id: 'advocateName', name: 'Advocate Name', type: 'text', placeholder: 'Enter advocate name', required: true },
      { id: 'date', name: 'Date', type: 'date', required: true }
    ]
  },
  {
    id: 'legal-notice',
    name: 'Legal Notice',
    category: 'Legal Notice',
    description: 'Legal notice for recovery of money/breach of contract',
    content: `# **LEGAL NOTICE**

**FROM:**

{{advocateName}}
Advocate
{{advocateAddress}}
Email: {{advocateEmail}}
Phone: {{advocatePhone}}

**DATE:** {{date}}

**TO:**

{{recipientName}}
{{recipientAddress}}
Email: {{recipientEmail}}

**SUBJECT:** LEGAL NOTICE FOR {{noticeSubject}}

Dear Sir/Madam,

Under instructions and on behalf of my client {{clientName}}, residing at {{clientAddress}}, I hereby serve you with the following legal notice:

## **NOTICE UNDER SECTION 80 OF THE CODE OF CIVIL PROCEDURE, 1908 (IF APPLICABLE)**

1. That my client entered into an agreement with you dated {{agreementDate}} whereby {{agreementTerms}}.

2. That you have committed breach of the said agreement by {{breachDetails}}.

3. That due to your breach, my client has suffered damages to the tune of ₹{{damages}}.

4. That despite repeated verbal and written requests, you have failed to remedy the breach and pay the due amount.

5. That I hereby call upon you to:

- a) Remedy the breach within {{remedyPeriod}} days from the receipt of this notice;
- b) Pay the sum of ₹{{amount}} to my client;
- c) Pay interest at 18% per annum from the due date till actual payment.

6. Should you fail to comply with the above demands within the stipulated time, my client shall be constrained to initiate appropriate civil/criminal proceedings against you at your sole risk, cost and consequences.

7. Please note that a copy of this notice is retained in my office for further action.

A copy of this notice has been endorsed to my client for record and future action.

**Yours faithfully,**

**{{advocateName}}**
Advocate for {{clientName}}`,
    fields: [
      { id: 'advocateName', name: 'Advocate Name', type: 'text', placeholder: 'Enter advocate name', required: true },
      { id: 'advocateAddress', name: 'Advocate Address', type: 'textarea', placeholder: 'Enter advocate address', required: true },
      { id: 'advocateEmail', name: 'Advocate Email', type: 'text', placeholder: 'Enter email', required: true },
      { id: 'advocatePhone', name: 'Advocate Phone', type: 'text', placeholder: 'Enter phone number', required: true },
      { id: 'date', name: 'Date', type: 'date', required: true },
      { id: 'recipientName', name: 'Recipient Name', type: 'text', placeholder: 'Enter recipient name', required: true },
      { id: 'recipientAddress', name: 'Recipient Address', type: 'textarea', placeholder: 'Enter recipient address', required: true },
      { id: 'recipientEmail', name: 'Recipient Email', type: 'text', placeholder: 'Enter email', required: true },
      { id: 'noticeSubject', name: 'Notice Subject', type: 'text', placeholder: 'Enter subject', required: true },
      { id: 'clientName', name: 'Client Name', type: 'text', placeholder: 'Enter client name', required: true },
      { id: 'clientAddress', name: 'Client Address', type: 'textarea', placeholder: 'Enter client address', required: true },
      { id: 'agreementDate', name: 'Agreement Date', type: 'date', required: true },
      { id: 'agreementTerms', name: 'Agreement Terms', type: 'textarea', placeholder: 'Enter agreement terms', required: true },
      { id: 'breachDetails', name: 'Breach Details', type: 'textarea', placeholder: 'Enter breach details', required: true },
      { id: 'damages', name: 'Damages', type: 'number', placeholder: 'Enter damages amount', required: true },
      { id: 'remedyPeriod', name: 'Remedy Period', type: 'number', placeholder: 'Enter days', required: true },
      { id: 'amount', name: 'Amount', type: 'number', placeholder: 'Enter amount', required: true }
    ]
  },
  {
    id: 'affidavit-general',
    name: 'General Affidavit',
    category: 'Affidavit',
    description: 'General purpose affidavit for sworn statements',
    content: `# **AFFIDAVIT**

---

I, **{{deponentName}}**, son/daughter/wife of **{{parentName}}**, aged **{{age}}** years, residing at {{address}}, do hereby solemnly affirm and declare as under:

1. That I am the deponent herein and am fully conversant with the facts stated herein.

2. That {{statement1}}.

3. That {{statement2}}.

4. That {{statement3}}.

5. That the contents of this affidavit are true and correct to the best of my knowledge and belief and nothing material has been concealed therefrom.

**DEPONENT**

---

## **VERIFICATION**

Verified at **{{place}}** on this **{{date}}** that the contents of the above affidavit are true and correct to the best of my knowledge and belief.

**DEPONENT**

**Before me,**

**{{notaryName}}**
Notary Public / Oath Commissioner`,
    fields: [
      { id: 'deponentName', name: 'Deponent Name', type: 'text', placeholder: 'Full name', required: true },
      { id: 'parentName', name: 'Father/Mother/Husband Name', type: 'text', placeholder: 'Enter name', required: true },
      { id: 'age', name: 'Age', type: 'number', placeholder: 'Age in years', required: true },
      { id: 'address', name: 'Address', type: 'textarea', placeholder: 'Full residential address', required: true },
      { id: 'statement1', name: 'Statement 1', type: 'textarea', placeholder: 'First statement', required: true },
      { id: 'statement2', name: 'Statement 2', type: 'textarea', placeholder: 'Second statement', required: false },
      { id: 'statement3', name: 'Statement 3', type: 'textarea', placeholder: 'Third statement', required: false },
      { id: 'place', name: 'Place', type: 'text', placeholder: 'City/Place', required: true },
      { id: 'date', name: 'Date', type: 'date', required: true },
      { id: 'notaryName', name: 'Notary Name', type: 'text', placeholder: 'Notary/Oath Commissioner name', required: true },
    ]
  },
  {
    id: 'writ-petition-hc',
    name: 'Writ Petition (High Court)',
    category: 'High Court',
    description: 'Writ Petition under Article 226 of Constitution before High Court',
    content: `# **IN THE HIGH COURT OF {{highCourtState}}**

## **AT {{highCourtBench}}**

### **WRIT PETITION ({{writType}}) NO. ______ OF {{year}}**

**IN THE MATTER OF:**

**{{petitionerName}}**
{{petitionerAddress}}
...Petitioner

**VERSUS**

**{{respondentName}}**
{{respondentAddress}}
...Respondent

---

## **SYNOPSIS**

{{synopsis}}

---

## **LIST OF DATES**

{{listOfDates}}

---

### **WRIT PETITION UNDER ARTICLE 226 OF THE CONSTITUTION OF INDIA**

**TO,**

**THE HON'BLE THE CHIEF JUSTICE**
**AND HIS/HER COMPANION JUDGES OF THE**
**HIGH COURT OF {{highCourtState}}**

The humble petition of the petitioner above named.

## **MOST RESPECTFULLY SHEWETH:**

1. That the petitioner is {{petitionerDescription}} and is aggrieved by the impugned action/order dated {{impugnedOrderDate}} passed by the {{respondentAuthority}}.

2. **BRIEF FACTS:**
{{briefFacts}}

3. **GROUNDS:**
{{grounds}}

4. That the petitioner has no other efficacious remedy except to approach this Hon'ble Court by way of this writ petition.

5. That the petitioner has not filed any other petition before any court challenging the same action.

## **PRAYER**

In view of the above, it is most respectfully prayed that this Hon'ble Court may be pleased to:

- a) Issue a writ of {{writType}} or any other appropriate writ, order or direction;
- b) {{specificRelief}};
- c) Pass such other orders as this Hon'ble Court may deem fit.

**AND FOR THIS ACT OF KINDNESS, THE PETITIONER AS IN DUTY BOUND, SHALL EVER PRAY.**

**{{advocateName}}**
Advocate for the Petitioner

Dated: {{date}}
Place: {{place}}`,
    fields: [
      { id: 'highCourtState', name: 'High Court State', type: 'text', placeholder: 'e.g. Judicature at Bombay', required: true },
      { id: 'highCourtBench', name: 'Bench Location', type: 'text', placeholder: 'e.g. Mumbai / Nagpur', required: true },
      { id: 'writType', name: 'Writ Type', type: 'select', options: ['Certiorari', 'Mandamus', 'Habeas Corpus', 'Prohibition', 'Quo Warranto'], required: true },
      { id: 'year', name: 'Year', type: 'number', placeholder: 'Year', required: true },
      { id: 'petitionerName', name: 'Petitioner Name', type: 'text', placeholder: 'Enter petitioner name', required: true },
      { id: 'petitionerAddress', name: 'Petitioner Address', type: 'textarea', placeholder: 'Full address of petitioner', required: true },
      { id: 'respondentName', name: 'Respondent Name', type: 'text', placeholder: 'Enter respondent name', required: true },
      { id: 'respondentAddress', name: 'Respondent Address', type: 'textarea', placeholder: 'Full address of respondent', required: true },
      { id: 'synopsis', name: 'Synopsis', type: 'textarea', placeholder: 'Brief summary of the case for quick reference by the court', required: true },
      { id: 'listOfDates', name: 'List of Dates', type: 'textarea', placeholder: 'Chronological list of key dates and events', required: true },
      { id: 'petitionerDescription', name: 'Petitioner Description', type: 'text', placeholder: 'e.g. a citizen of India', required: true },
      { id: 'impugnedOrderDate', name: 'Impugned Order Date', type: 'date', required: true },
      { id: 'respondentAuthority', name: 'Respondent Authority', type: 'text', placeholder: 'e.g. the State of Maharashtra', required: true },
      { id: 'briefFacts', name: 'Brief Facts', type: 'textarea', placeholder: 'Describe the facts of the case', required: true },
      { id: 'grounds', name: 'Grounds', type: 'textarea', placeholder: 'List the grounds for the petition', required: true },
      { id: 'specificRelief', name: 'Specific Relief', type: 'textarea', placeholder: 'Describe the specific relief sought', required: true },
      { id: 'advocateName', name: 'Advocate Name', type: 'text', placeholder: 'Enter advocate name', required: true },
      { id: 'date', name: 'Date', type: 'date', required: true },
      { id: 'place', name: 'Place', type: 'text', placeholder: 'Enter place', required: true },
    ]
  },
  {
    id: 'anticipatory-bail',
    name: 'Anticipatory Bail Application',
    category: 'Criminal',
    description: 'Application for anticipatory bail under Section 482 BNSS (formerly Section 438 CrPC)',
    content: `# **IN THE COURT OF SESSIONS JUDGE / ADDITIONAL SESSIONS JUDGE**

## **{{courtName}}**

### **ANTICIPATORY BAIL APPLICATION NO. ______ OF {{year}}**

**IN THE MATTER OF:**

**{{applicantName}}**
Son/Daughter of {{parentName}}
Residing at {{address}}
...Applicant/Accused

**VERSUS**

**STATE OF {{state}}**
Through {{policeStation}} Police Station
...Respondent

### **APPLICATION UNDER {{bailSection}} FOR GRANT OF ANTICIPATORY BAIL**

## **MOST RESPECTFULLY SUBMITTED:**

1. That the applicant apprehends arrest in connection with FIR No. {{firNumber}} / Case Crime No. {{caseNumber}} registered at Police Station {{policeStation}} for the alleged offence under Section(s) {{offenceSections}}.

2. That the applicant is innocent and has been falsely implicated by the complainant due to {{motiveForFalseImplication}}.

3. That the applicant has deep roots in society and is a {{occupation}} residing at the above address for the past {{yearsOfResidence}} years.

4. That the applicant is not a habitual offender and has no prior criminal record.

5. That there is no possibility of the applicant fleeing from justice or tampering with evidence.

6. That the applicant is ready and willing to cooperate with the investigation and to abide by such conditions as may be imposed by this Hon'ble Court.

## **PRAYER**

In view of the above, it is most respectfully prayed that this Hon'ble Court may be pleased to:

- a) Direct that in the event of arrest of the applicant, he/she be released on bail;
- b) Impose such conditions as this Hon'ble Court may deem fit;
- c) Pass such other orders as this Hon'ble Court may deem proper.

**{{advocateName}}**
Advocate for the Applicant

Dated: {{date}}`,
    fields: [
      { id: 'courtName', name: 'Court Name', type: 'text', placeholder: 'Enter court name and location', required: true },
      { id: 'year', name: 'Year', type: 'number', placeholder: 'Year', required: true },
      { id: 'applicantName', name: 'Applicant Name', type: 'text', placeholder: 'Full name of applicant', required: true },
      { id: 'parentName', name: 'Father/Mother Name', type: 'text', placeholder: 'Enter name', required: true },
      { id: 'address', name: 'Address', type: 'textarea', placeholder: 'Full residential address', required: true },
      { id: 'state', name: 'State', type: 'text', placeholder: 'State name', required: true },
      { id: 'policeStation', name: 'Police Station', type: 'text', placeholder: 'Police station name', required: true },
      { id: 'bailSection', name: 'Applicable Section', type: 'select', options: ['Section 482 BNSS (formerly Section 438 CrPC)', 'Section 438 CrPC (pre-July 2024 cases)'], required: true },
      { id: 'firNumber', name: 'FIR Number', type: 'text', placeholder: 'FIR number if registered', required: false },
      { id: 'caseNumber', name: 'Case/Crime Number', type: 'text', placeholder: 'Case/Crime number', required: true },
      { id: 'offenceSections', name: 'Offence Sections (BNS/IPC)', type: 'text', placeholder: 'e.g. 318(4) BNS or 420/468 IPC', required: true },
      { id: 'motiveForFalseImplication', name: 'Motive for False Implication', type: 'textarea', placeholder: 'Describe the motive', required: true },
      { id: 'occupation', name: 'Occupation', type: 'text', placeholder: 'e.g. businessman, teacher', required: true },
      { id: 'yearsOfResidence', name: 'Years of Residence', type: 'number', placeholder: 'Number of years', required: true },
      { id: 'advocateName', name: 'Advocate Name', type: 'text', placeholder: 'Advocate name', required: true },
      { id: 'date', name: 'Date', type: 'date', required: true },
    ]
  },
  {
    id: 'power-of-attorney',
    name: 'General Power of Attorney',
    category: 'Agreement',
    description: 'General Power of Attorney authorizing an agent to act on behalf of the principal',
    content: `# **GENERAL POWER OF ATTORNEY**

---

KNOW ALL MEN BY THESE PRESENTS that I/We, **{{principalName}}**, son/daughter/wife of **{{principalParentName}}**, aged **{{principalAge}}** years, residing at {{principalAddress}} (hereinafter referred to as **"the Principal"**), do hereby nominate, appoint and constitute **{{agentName}}**, son/daughter/wife of **{{agentParentName}}**, aged **{{agentAge}}** years, residing at {{agentAddress}} (hereinafter referred to as **"the Attorney/Agent"**), to be my/our true and lawful Attorney to act in my/our name and on my/our behalf and to do and execute the following acts, deeds and things:

1. To manage, supervise and administer {{propertyDescription}}.

2. To appear before all Government offices, Revenue authorities, Registration offices, Courts and all other bodies and to sign all applications, papers and documents.

3. To sell, purchase, mortgage, lease or otherwise deal with the above property on such terms and conditions as the Attorney thinks fit.

4. To receive and give receipts for any monies due and payable.

5. To engage advocates and to conduct litigation in any court of law.

6. {{additionalPowers}}.

AND I/WE hereby ratify and confirm all acts, deeds and things lawfully done by the said Attorney by virtue of this Power of Attorney.

**IN WITNESS WHEREOF**, I/We have hereunto set my/our hand on this **{{date}}** at **{{place}}**.

---

**PRINCIPAL:** {{principalName}}

Signature: ____________________

**WITNESS:**

1. Name: ____________________
   Address: ____________________

2. Name: ____________________
   Address: ____________________`,
    fields: [
      { id: 'principalName', name: 'Principal Name', type: 'text', placeholder: 'Person granting power', required: true },
      { id: 'principalParentName', name: "Principal's Father/Mother Name", type: 'text', placeholder: 'Enter name', required: true },
      { id: 'principalAge', name: "Principal's Age", type: 'number', placeholder: 'Age in years', required: true },
      { id: 'principalAddress', name: "Principal's Address", type: 'textarea', placeholder: 'Full address', required: true },
      { id: 'agentName', name: 'Agent/Attorney Name', type: 'text', placeholder: 'Person receiving power', required: true },
      { id: 'agentParentName', name: "Agent's Father/Mother Name", type: 'text', placeholder: 'Enter name', required: true },
      { id: 'agentAge', name: "Agent's Age", type: 'number', placeholder: 'Age in years', required: true },
      { id: 'agentAddress', name: "Agent's Address", type: 'textarea', placeholder: 'Full address', required: true },
      { id: 'propertyDescription', name: 'Property Description', type: 'textarea', placeholder: 'Describe the property/assets', required: true },
      { id: 'additionalPowers', name: 'Additional Powers', type: 'textarea', placeholder: 'Any additional powers to be granted', required: false },
      { id: 'date', name: 'Date', type: 'date', required: true },
      { id: 'place', name: 'Place', type: 'text', placeholder: 'City/Place', required: true },
    ]
  },
  {
    id: 'rent-agreement',
    name: 'Rent Agreement',
    category: 'Agreement',
    description: 'Residential/Commercial rent agreement between landlord and tenant',
    content: `# **RENT AGREEMENT**

---

This Rent Agreement is entered into on **{{date}}** at **{{place}}**.

**BETWEEN**

**{{landlordName}}**, son/daughter of **{{landlordParentName}}**, residing at {{landlordAddress}} (hereinafter referred to as **"the Landlord/Licensor"**), of the ONE PART;

**AND**

**{{tenantName}}**, son/daughter of **{{tenantParentName}}**, residing at {{tenantPermanentAddress}} (hereinafter referred to as **"the Tenant/Licensee"**), of the OTHER PART.

WHEREAS the Landlord is the lawful owner of the premises situated at **{{propertyAddress}}** (hereinafter referred to as **"the said premises"**).

**NOW THIS AGREEMENT WITNESSETH as under:**

1. **TERM:** The Landlord hereby grants leave and license to the Tenant to use and occupy the said premises for a period of **{{leaseDuration}}** months commencing from **{{commencementDate}}**.

2. **RENT:** The Tenant shall pay a monthly rent of **₹{{monthlyRent}}** (Rupees {{monthlyRentWords}} only) on or before the **{{rentDueDay}}**th day of each month.

3. **SECURITY DEPOSIT:** The Tenant has paid a refundable security deposit of **₹{{securityDeposit}}** which shall be refunded at the time of vacating the premises after deducting any dues.

4. **USE:** The premises shall be used only for **{{purposeOfUse}}** purposes.

5. **MAINTENANCE:** The Tenant shall maintain the premises in good condition and shall not make any structural changes without prior written consent of the Landlord.

6. **UTILITIES:** The Tenant shall pay all electricity, water and other utility charges separately.

7. **TERMINATION:** Either party may terminate this agreement by giving **{{noticePeriod}}** days prior written notice.

---

**IN WITNESS WHEREOF** the parties have signed this agreement on the date mentioned above.

**LANDLORD:** {{landlordName}}

Signature: ____________________

**TENANT:** {{tenantName}}

Signature: ____________________

**WITNESS:**

1. ____________________
2. ____________________`,
    fields: [
      { id: 'date', name: 'Agreement Date', type: 'date', required: true },
      { id: 'place', name: 'Place', type: 'text', placeholder: 'City', required: true },
      { id: 'landlordName', name: 'Landlord Name', type: 'text', placeholder: 'Full name', required: true },
      { id: 'landlordParentName', name: "Landlord's Father/Mother Name", type: 'text', placeholder: 'Enter name', required: true },
      { id: 'landlordAddress', name: "Landlord's Address", type: 'textarea', placeholder: 'Full address', required: true },
      { id: 'tenantName', name: 'Tenant Name', type: 'text', placeholder: 'Full name', required: true },
      { id: 'tenantParentName', name: "Tenant's Father/Mother Name", type: 'text', placeholder: 'Enter name', required: true },
      { id: 'tenantPermanentAddress', name: "Tenant's Permanent Address", type: 'textarea', placeholder: 'Permanent address', required: true },
      { id: 'propertyAddress', name: 'Property Address', type: 'textarea', placeholder: 'Full address of the rented property', required: true },
      { id: 'leaseDuration', name: 'Lease Duration (months)', type: 'number', placeholder: 'e.g. 11', required: true },
      { id: 'commencementDate', name: 'Commencement Date', type: 'date', required: true },
      { id: 'monthlyRent', name: 'Monthly Rent (₹)', type: 'number', placeholder: 'Amount in numbers', required: true },
      { id: 'monthlyRentWords', name: 'Monthly Rent (in words)', type: 'text', placeholder: 'e.g. Ten Thousand', required: true },
      { id: 'rentDueDay', name: 'Rent Due Day', type: 'number', placeholder: 'Day of month (1-28)', required: true },
      { id: 'securityDeposit', name: 'Security Deposit (₹)', type: 'number', placeholder: 'Amount', required: true },
      { id: 'purposeOfUse', name: 'Purpose of Use', type: 'select', options: ['Residential', 'Commercial', 'Office'], required: true },
      { id: 'noticePeriod', name: 'Notice Period (days)', type: 'number', placeholder: 'e.g. 30', required: true },
    ]
  },
  {
    id: 'consumer-complaint',
    name: 'Consumer Complaint',
    category: 'Application',
    description: 'Complaint before District Consumer Disputes Redressal Commission',
    content: `# **BEFORE THE DISTRICT CONSUMER DISPUTES REDRESSAL COMMISSION**

## **{{districtName}}**

### **CONSUMER COMPLAINT NO. ______ OF {{year}}**

**IN THE MATTER OF:**

**{{complainantName}}**
{{complainantAddress}}
...Complainant

**VERSUS**

**{{oppositePartyName}}**
{{oppositePartyAddress}}
...Opposite Party

### **COMPLAINT UNDER SECTION 35 OF THE CONSUMER PROTECTION ACT, 2019**

## **MOST RESPECTFULLY SUBMITTED:**

1. That the complainant is a consumer as defined under the Consumer Protection Act, 2019.

2. That the opposite party is engaged in the business of {{businessDescription}} and is a service provider/seller of goods.

3. That on **{{transactionDate}}**, the complainant {{transactionDetails}} for a consideration of **₹{{amount}}**.

4. That the opposite party is guilty of deficiency in service/unfair trade practice in as much as {{deficiencyDetails}}.

5. That the complainant sent a legal notice dated **{{noticeDateSent}}** to the opposite party but no satisfactory response was received.

6. That the cause of action arose on **{{causeOfActionDate}}** within the jurisdiction of this Hon'ble Commission.

## **RELIEF SOUGHT:**

- a) Direct the opposite party to refund **₹{{refundAmount}}** with interest;
- b) Direct the opposite party to pay **₹{{compensationAmount}}** as compensation for mental agony and harassment;
- c) Direct the opposite party to pay **₹{{litigationCost}}** as cost of litigation;
- d) Pass such other orders as this Hon'ble Commission deems fit.

**COMPLAINANT:** {{complainantName}}

Dated: {{date}}`,
    fields: [
      { id: 'districtName', name: 'District Name', type: 'text', placeholder: 'e.g. Mumbai Suburban', required: true },
      { id: 'year', name: 'Year', type: 'number', placeholder: 'Year', required: true },
      { id: 'complainantName', name: 'Complainant Name', type: 'text', placeholder: 'Full name', required: true },
      { id: 'complainantAddress', name: 'Complainant Address', type: 'textarea', placeholder: 'Full address', required: true },
      { id: 'oppositePartyName', name: 'Opposite Party Name', type: 'text', placeholder: 'Company/person name', required: true },
      { id: 'oppositePartyAddress', name: 'Opposite Party Address', type: 'textarea', placeholder: 'Full address', required: true },
      { id: 'businessDescription', name: 'Business Description', type: 'text', placeholder: 'e.g. selling mobile phones', required: true },
      { id: 'transactionDate', name: 'Transaction Date', type: 'date', required: true },
      { id: 'transactionDetails', name: 'Transaction Details', type: 'textarea', placeholder: 'What was purchased/service availed', required: true },
      { id: 'amount', name: 'Transaction Amount (₹)', type: 'number', placeholder: 'Amount paid', required: true },
      { id: 'deficiencyDetails', name: 'Deficiency Details', type: 'textarea', placeholder: 'Describe the deficiency/unfair practice', required: true },
      { id: 'noticeDateSent', name: 'Legal Notice Date', type: 'date', required: true },
      { id: 'causeOfActionDate', name: 'Cause of Action Date', type: 'date', required: true },
      { id: 'refundAmount', name: 'Refund Amount (₹)', type: 'number', placeholder: 'Amount to be refunded', required: true },
      { id: 'compensationAmount', name: 'Compensation Amount (₹)', type: 'number', placeholder: 'Compensation sought', required: true },
      { id: 'litigationCost', name: 'Litigation Cost (₹)', type: 'number', placeholder: 'Cost of litigation', required: true },
      { id: 'date', name: 'Date', type: 'date', required: true },
    ]
  },
  {
    id: 'divorce-petition',
    name: 'Divorce Petition (Mutual Consent)',
    category: 'Civil',
    description: 'Petition for divorce by mutual consent under Section 13B HMA / Section 28 SMA',
    content: `# **IN THE FAMILY COURT AT {{courtLocation}}**

### **PETITION NO. ______ OF {{year}}**

**IN THE MATTER OF:**

**{{petitioner1Name}}**
...Petitioner No. 1 (Husband/Wife)

**AND**

**{{petitioner2Name}}**
...Petitioner No. 2 (Wife/Husband)

### **PETITION FOR DIVORCE BY MUTUAL CONSENT UNDER SECTION 13B OF THE HINDU MARRIAGE ACT, 1955**

## **MOST RESPECTFULLY SUBMITTED:**

1. That the marriage between the petitioners was solemnized on **{{marriageDate}}** at **{{marriagePlace}}** as per **{{marriageRites}}** rites and customs.

2. That the petitioners have been living separately since **{{separationDate}}** and have not been able to reconcile their differences.

3. That both the petitioners have mutually agreed to dissolve their marriage as the marriage has irretrievably broken down.

4. **SETTLEMENT TERMS:**
   - a) Maintenance: {{maintenanceTerms}}
   - b) Custody of children (if any): {{custodyTerms}}
   - c) Property settlement: {{propertySettlement}}

5. That the petitioners have no other matrimonial petition pending before any other court.

6. That there are **{{numberOfChildren}}** child/children from this marriage.

## **PRAYER**

In view of the above, both the petitioners jointly pray that this Hon'ble Court may be pleased to:

- a) Decree dissolution of marriage between the petitioners by mutual consent;
- b) Pass such other orders as this Hon'ble Court deems fit.

**PETITIONER NO. 1:** {{petitioner1Name}}

Signature: ____________________

**PETITIONER NO. 2:** {{petitioner2Name}}

Signature: ____________________

**{{advocateName}}**
Advocate for the Petitioners

Dated: {{date}}
Place: {{place}}`,
    fields: [
      { id: 'courtLocation', name: 'Court Location', type: 'text', placeholder: 'City/District', required: true },
      { id: 'year', name: 'Year', type: 'number', placeholder: 'Year', required: true },
      { id: 'petitioner1Name', name: 'Petitioner 1 Name (Husband)', type: 'text', placeholder: 'Full name', required: true },
      { id: 'petitioner2Name', name: 'Petitioner 2 Name (Wife)', type: 'text', placeholder: 'Full name', required: true },
      { id: 'marriageDate', name: 'Marriage Date', type: 'date', required: true },
      { id: 'marriagePlace', name: 'Marriage Place', type: 'text', placeholder: 'City/Temple/Court', required: true },
      { id: 'marriageRites', name: 'Marriage Rites', type: 'select', options: ['Hindu', 'Muslim', 'Christian', 'Special Marriage Act'], required: true },
      { id: 'separationDate', name: 'Separation Date', type: 'date', required: true },
      { id: 'maintenanceTerms', name: 'Maintenance Terms', type: 'textarea', placeholder: 'Agreed maintenance terms', required: true },
      { id: 'custodyTerms', name: 'Custody Terms', type: 'textarea', placeholder: 'Agreed custody terms or N/A', required: true },
      { id: 'propertySettlement', name: 'Property Settlement', type: 'textarea', placeholder: 'Agreed property settlement', required: true },
      { id: 'numberOfChildren', name: 'Number of Children', type: 'number', placeholder: 'Enter 0 if none', required: true },
      { id: 'advocateName', name: 'Advocate Name', type: 'text', placeholder: 'Advocate name', required: true },
      { id: 'date', name: 'Date', type: 'date', required: true },
      { id: 'place', name: 'Place', type: 'text', placeholder: 'City/Place', required: true },
    ]
  },
  {
    id: 'vakalatnama',
    name: 'Vakalatnama',
    category: 'Application',
    description: 'Authorization letter from client to advocate to appear in court',
    content: `# **VAKALATNAMA**

---

## **IN THE COURT OF {{courtName}}**

**CASE NO.:** {{caseNumber}}

**{{partyName}}**
...{{partyDesignation}}

**VERSUS**

**{{oppositePartyName}}**
...{{oppositePartyDesignation}}

I/We, **{{clientName}}**, the **{{partyDesignation}}** in the above-mentioned case, do hereby appoint, retain and authorise:

**{{advocateName}}**
Advocate, {{barCouncilEnrollment}}
{{advocateAddress}}

to be my/our Advocate in the above matter and on my/our behalf to:

1. Appear, plead and act in the above case and all proceedings connected therewith including appeals, revisions, executions, etc.
2. File, sign and verify pleadings, petitions, applications, appeals, affidavits and other documents.
3. Withdraw, compromise or settle the case on such terms as my/our Advocate thinks fit.
4. Engage and instruct another Advocate to appear in this case.
5. Receive any money payable to me/us and give receipts thereof.

And I/We agree to ratify all acts done by my/our said Advocate in the pursuance of this authority.

Dated: **{{date}}**

---

**CLIENT:** {{clientName}}

Signature: ____________________

**ACCEPTED:**

**{{advocateName}}**
Advocate`,
    fields: [
      { id: 'courtName', name: 'Court Name', type: 'text', placeholder: 'Full court name', required: true },
      { id: 'caseNumber', name: 'Case Number', type: 'text', placeholder: 'Case/Suit number', required: true },
      { id: 'partyName', name: 'Client/Party Name', type: 'text', placeholder: 'Your client name', required: true },
      { id: 'partyDesignation', name: 'Party Designation', type: 'select', options: ['Petitioner', 'Respondent', 'Plaintiff', 'Defendant', 'Appellant', 'Complainant', 'Accused'], required: true },
      { id: 'oppositePartyName', name: 'Opposite Party Name', type: 'text', placeholder: 'Opposite party name', required: true },
      { id: 'oppositePartyDesignation', name: 'Opposite Party Designation', type: 'select', options: ['Petitioner', 'Respondent', 'Plaintiff', 'Defendant', 'Appellant', 'Complainant', 'Accused'], required: true },
      { id: 'clientName', name: 'Client Full Name', type: 'text', placeholder: 'Full name of client', required: true },
      { id: 'advocateName', name: 'Advocate Name', type: 'text', placeholder: 'Full name of advocate', required: true },
      { id: 'barCouncilEnrollment', name: 'Bar Council Enrollment No.', type: 'text', placeholder: 'Enrollment number', required: true },
      { id: 'advocateAddress', name: "Advocate's Address", type: 'textarea', placeholder: 'Office address', required: true },
      { id: 'date', name: 'Date', type: 'date', required: true },
    ]
  },
];

export const templateCategories = [
  'Supreme Court',
  'High Court',
  'Civil',
  'Criminal',
  'Legal Notice',
  'Affidavit',
  'Application',
  'Agreement'
];
