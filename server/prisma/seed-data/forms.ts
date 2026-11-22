import type {
  FormField,
  FormOption,
  FormSchema,
  FormSection,
} from '../../src/forms/form-schema';

/**
 * The two inquiry forms a tenant starts with: residence (نموذج استعلام عن سكن
 * العميل) and work (نموذج استعلام عن عمل العميل).
 *
 * They follow the paper forms the agency already uses, field for field and in
 * the same order, because the same definition renders three ways: the
 * investigator's form, the on-screen sheet a reviewer types the paper into,
 * and the blank sheet printed for the investigator to fill in by hand. If the
 * order drifted from the paper, a reviewer transcribing it would be hunting
 * for every answer.
 *
 * WHAT IS NOT HERE. The customer's name, phone numbers, case number and the
 * address the bank sent are already on the case, so the sheet prints them in
 * its header; asking for them again would invite two versions of one fact.
 * The office stamp is a box on paper and has no electronic answer.
 *
 * MOST FIELDS ARE OPTIONAL ON PURPOSE. The real forms are full of "لم يحدد"
 * (not stated): a company owner who will not give the capital is a finding,
 * not a missing answer. Free-text cells therefore stay free text, even where
 * a date or number would be tidier, so "لم يحدد" and "لم يتم الدخول" can be
 * written into them.
 *
 * Every choice row is RADIO — exactly one box ticked per line, as on paper.
 * The sheet draws them as tick boxes.
 */

// ─── Builders ───────────────────────────────────────────────────────────────

const opt = (value: string, labelAr: string, labelEn: string): FormOption => ({
  value,
  labelAr,
  labelEn,
});

const YES_NO: FormOption[] = [
  opt('YES', 'نعم', 'Yes'),
  opt('NO', 'لا', 'No'),
];

function text(
  key: string,
  labelAr: string,
  labelEn: string,
  width = 6,
): FormField {
  return { key, type: 'TEXT', labelAr, labelEn, width };
}

function note(key: string, labelAr: string, labelEn: string): FormField {
  return { key, type: 'LONG_TEXT', labelAr, labelEn, width: 12 };
}

function choice(
  key: string,
  labelAr: string,
  labelEn: string,
  options: FormOption[],
  width = 12,
): FormField {
  return { key, type: 'RADIO', labelAr, labelEn, options, width };
}

function section(
  key: string,
  titleAr: string,
  titleEn: string,
  fields: FormField[],
): FormSection {
  return { key, titleAr, titleEn, fields };
}

/** The signature row at the foot of both forms. */
function signOff(): FormSection {
  return section('signOff', 'التوقيعات', 'Sign-off', [
    text('investigatorName', 'اسم المستعلم', 'Investigator', 4),
    text('reviewerName', 'اسم المراجع', 'Reviewer', 4),
    text('followUpName', 'اسم المتابع', 'Follow-up officer', 4),
    { key: 'inquiryDate', type: 'DATE', labelAr: 'تاريخ الاستعلام', labelEn: 'Inquiry date', width: 4 },
    { key: 'inquiryTime', type: 'TIME', labelAr: 'وقت الاستعلام', labelEn: 'Inquiry time', width: 4 },
  ]);
}

// ─── Residence ──────────────────────────────────────────────────────────────

export const RESIDENCE_FORM_SCHEMA: FormSchema = {
  sections: [
    section('visit', 'بيانات الزيارة', 'Visit details', [
      text('actualAddress', 'العنوان الفعلي', 'Actual address', 12),
      text('areaDistrict', 'المنطقة / الحي', 'Area / district'),
      text('policeCenter', 'المركز', 'Centre'),
      text('personInterviewed', 'الشخص الذي تمت مقابلته', 'Person interviewed', 12),
    ]),

    section('areaAndResidence', 'بيانات عن المنطقة والسكن', 'Area and residence', [
      choice('propertyType', 'نوع العقار', 'Property type', [
        opt('VILLA', 'فيلا', 'Villa'),
        opt('TOWER', 'برج', 'Tower'),
        opt('BUILDING', 'عمارة', 'Apartment building'),
        opt('HOUSE', 'بيت', 'House'),
      ], 6),
      choice('propertyLevel', 'مستوى العقار', 'Property condition', [
        opt('GOOD', 'جيد', 'Good'),
        opt('AVERAGE', 'متوسط', 'Average'),
        opt('OLD', 'قديم', 'Old'),
        opt('DILAPIDATED', 'متهالك', 'Dilapidated'),
      ], 6),
      choice('residenceType', 'نوع السكن', 'Tenure', [
        opt('OWNED', 'تمليك', 'Owned'),
        opt('OLD_RENT', 'إيجار قديم', 'Old-law rent'),
        opt('NEW_RENT', 'إيجار جديد', 'New-law rent'),
      ], 8),
      text('residenceDuration', 'مدة الإقامة في السكن', 'Time at this address', 4),
      choice('residenceAppearance', 'مظهر السكن', 'Appearance', [
        opt('VERY_GOOD', 'جيد جدًا', 'Very good'),
        opt('GOOD', 'جيد', 'Good'),
        opt('NORMAL', 'عادي', 'Ordinary'),
        opt('POOR', 'ضعيف', 'Poor'),
      ], 6),
      choice('furniture', 'الأثاث', 'Furniture', [
        opt('NEW', 'جديد', 'New'),
        opt('AVERAGE', 'متوسط', 'Average'),
        opt('OLD', 'قديم', 'Old'),
      ], 6),
      choice('floorArea', 'المساحة', 'Floor area', [
        opt('UNDER_80', 'أقل من 80 متر', 'Under 80 m²'),
        opt('FROM_80_TO_100', 'بين 80 و 100 متر', '80–100 m²'),
        opt('OVER_100', 'أكبر من 100 متر', 'Over 100 m²'),
      ]),
      choice('neighbourhood', 'المنطقة', 'Neighbourhood', [
        opt('UPSCALE', 'راقية', 'Upscale'),
        opt('AVERAGE', 'متوسطة', 'Average'),
        opt('POPULAR', 'شعبية', 'Working-class'),
        opt('INFORMAL', 'عشوائية', 'Informal'),
      ]),
      choice('accessibility', 'إمكانية الوصول', 'Ease of access', [
        opt('EASY', 'سهل', 'Easy'),
        opt('AVERAGE', 'متوسط', 'Average'),
        opt('HARD', 'صعب', 'Difficult'),
      ], 5),
      choice('carAccess', 'هل يمكن دخول المنطقة بالسيارة', 'Reachable by car', YES_NO, 7),
      text('nearestLandmark', 'أقرب علامة مميزة', 'Nearest landmark', 12),
      choice('streetType', 'وصف الشارع', 'Street', [
        opt('MAIN', 'رئيسي', 'Main road'),
        opt('SIDE', 'جانبي', 'Side street'),
        opt('DARB', 'درب', 'Darb'),
        opt('ALLEY', 'حارة', 'Alley'),
      ], 7),
      choice('streetCondition', 'حالة الشارع', 'Street surface', [
        opt('PAVED', 'ممهد', 'Paved'),
        opt('UNPAVED', 'غير ممهد', 'Unpaved'),
      ], 5),
    ]),

    section('neighbours', 'بيانات من البواب والجيران', 'From the doorman and neighbours', [
      choice('customerResides', 'هل العميل مقيم في هذا المنزل', 'Does the customer live here', YES_NO, 6),
      choice('livesWith', 'هل العميل مقيم مع', 'Lives with', [
        opt('FAMILY', 'عائلته', 'Family'),
        opt('SPOUSE', 'زوجته', 'Spouse'),
        opt('ALONE', 'بمفرده', 'Alone'),
      ], 6),
      text(
        'referencePerson',
        'اسم شخص يمكن الرجوع إليه / أرقام التليفونات الخاصة به',
        'Reference contact and phone numbers',
        12,
      ),
    ]),

    section('notes', 'الملاحظات', 'Notes', [
      note('areaNotes', 'ملاحظات عن المنطقة والسكن', 'Notes on the area and residence'),
      note('customerNotes', 'ملاحظات عن العميل', 'Notes on the customer'),
      note('investigatorOpinion', 'رأي المستعلم', "Investigator's opinion"),
    ]),

    signOff(),
  ],
};

// ─── Work ───────────────────────────────────────────────────────────────────

export const WORKPLACE_FORM_SCHEMA: FormSchema = {
  sections: [
    section('visit', 'بيانات الزيارة', 'Visit details', [
      text('companyName', 'اسم الشركة', 'Company name', 12),
      text('actualAddress', 'العنوان الفعلي', 'Actual address', 12),
      text('personInterviewed', 'الشخص الذي تمت مقابلته', 'Person interviewed', 8),
      text('personInterviewedJob', 'الوظيفة', 'Their position', 4),
    ]),

    section('company', 'بيانات عن الشركة', 'The company', [
      text('foundedDate', 'تاريخ التأسيس', 'Founded', 4),
      text('legalForm', 'الشكل القانوني', 'Legal form', 4),
      text('capital', 'رأس مال الشركة', 'Capital', 4),
      text('activityType', 'نوع النشاط', 'Line of business', 12),
      choice('activityLevel', 'مستوى النشاط', 'Activity level', [
        opt('EXCELLENT', 'ممتاز', 'Excellent'),
        opt('GOOD', 'جيد', 'Good'),
        opt('WEAK', 'ضعيف', 'Weak'),
        opt('NONE', 'لا يوجد نشاط', 'No activity'),
      ], 7),
      choice('businessMovement', 'حركة العمل', 'Business traffic', [
        opt('HIGH', 'مرتفعة', 'High'),
        opt('NORMAL', 'عادية', 'Normal'),
        opt('WEAK', 'ضعيفة', 'Weak'),
      ], 5),
      text('employeesCount', 'عدد العاملين بالشركة', 'Number of employees'),
      text('hasBranches', 'هل يوجد فروع', 'Branches'),
      text('branchAddresses', 'عناوين الفروع والمخازن', 'Branch and warehouse addresses', 12),
      text('ownersPartners', 'أسماء أصحاب العمل / الشركاء', 'Owners / partners', 12),
      text('signatoryName', 'من له حق التوقيع - الاسم', 'Authorised signatory', 8),
      text('signatoryJob', 'الوظيفة', 'Signatory position', 4),
      choice('hasSignboard', 'هل توجد لافتة', 'Is there a signboard', YES_NO, 6),
      choice('knownInArea', 'هل المنشأة معروفة بالمنطقة', 'Known in the area', YES_NO, 6),
      text('premisesEquipment', 'تجهيزات المنشأة', 'Premises fit-out'),
      text('premisesArea', 'مساحة المنشأة', 'Premises size'),
      choice('furnitureCondition', 'حالة الأثاث بالمنشأة', 'Furniture condition', [
        opt('UPSCALE', 'راقي', 'Upscale'),
        opt('AVERAGE', 'متوسط', 'Average'),
        opt('OLD', 'قديم', 'Old'),
        opt('DILAPIDATED', 'متهالك', 'Dilapidated'),
      ], 6),
      choice('accessibility', 'إمكانية الوصول للشركة', 'Ease of access', [
        opt('EASY', 'سهل', 'Easy'),
        opt('NORMAL', 'عادي', 'Normal'),
        opt('HARD', 'صعب', 'Difficult'),
      ], 6),
      text('propertyRelation', 'العلاقة القانونية للشركة بالعقار', 'Legal tenure of the premises'),
      text('occupancyDate', 'تاريخ شغل الشركة للعقار محل النشاط', 'Occupying the premises since'),
    ]),

    section('customer', 'بيانات عن العميل', 'The customer', [
      text('customerJob', 'وظيفة العميل', "Customer's position", 8),
      text('hiringDate', 'تاريخ التعيين', 'Hired', 4),
      choice('contractType', 'نوع العقد', 'Contract', [
        opt('TEMPORARY', 'مؤقت', 'Temporary'),
        opt('ANNUAL', 'سنوي', 'Annual'),
        opt('PERMANENT', 'دائم', 'Permanent'),
        opt('NONE', 'لا يوجد', 'None'),
      ]),
      text('income', 'دخل العميل', 'Income', 4),
      text('basicSalary', 'المرتب الأساسي', 'Basic salary', 4),
      text('commissions', 'عمولات وحوافز', 'Commission and bonuses', 4),
      text('insuranceNumber', 'الرقم التأميني إن وجد', 'Social insurance number', 4),
      text('qualification', 'مؤهل العميل', 'Qualification', 4),
      text('graduationYear', 'سنة التخرج', 'Graduation year', 4),
      choice('customerPresent', 'هل العميل متواجد أثناء الزيارة', 'Customer present at the visit', YES_NO, 6),
      choice('customerMet', 'هل تمت مقابلة العميل', 'Customer interviewed', YES_NO, 6),
    ]),

    section('notes', 'الملاحظات', 'Notes', [
      note('customerNotes', 'ملاحظات عن العميل', 'Notes on the customer'),
      note('workNotes', 'ملاحظات عن العمل', 'Notes on the workplace'),
      note('investigatorOpinion', 'رأي المستعلم', "Investigator's opinion"),
    ]),

    signOff(),
  ],
};

/**
 * Which investigation type each form serves, and what the template is called.
 * Shared by the demo seed and `seed-inquiry-forms.ts`, which installs these
 * into tenants that already exist.
 */
export const INQUIRY_FORMS = [
  {
    typeCode: 'RESIDENCE',
    templateCode: 'RESIDENCE_FORM',
    nameAr: 'نموذج استعلام عن سكن العميل',
    nameEn: 'Customer Residence Inquiry Form',
    schema: RESIDENCE_FORM_SCHEMA,
  },
  {
    typeCode: 'WORKPLACE',
    templateCode: 'WORKPLACE_FORM',
    nameAr: 'نموذج استعلام عن عمل العميل',
    nameEn: 'Customer Work Inquiry Form',
    schema: WORKPLACE_FORM_SCHEMA,
  },
] as const;
