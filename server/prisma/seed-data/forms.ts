import type { FormSchema } from '../../src/forms/form-schema';

/**
 * The two forms a demo tenant starts with.
 *
 * Written as real field-verification forms rather than placeholders, because
 * they are what demonstrates the conditional-logic engine: the residence form's
 * "customer not found" branch is exactly the example the brief gives, and it
 * only reads as a feature when the follow-up questions are the ones an
 * investigator would actually be asked.
 */

export const RESIDENCE_FORM_SCHEMA: FormSchema = {
  sections: [
    {
      key: 'visit',
      titleAr: 'بيانات الزيارة',
      titleEn: 'Visit Details',
      fields: [
        {
          key: 'visitDate',
          type: 'DATE',
          labelAr: 'تاريخ الزيارة',
          labelEn: 'Visit Date',
          required: true,
          width: 6,
        },
        {
          key: 'visitTime',
          type: 'TIME',
          labelAr: 'وقت الزيارة',
          labelEn: 'Visit Time',
          required: true,
          width: 6,
        },
        {
          key: 'addressFound',
          type: 'RADIO',
          labelAr: 'هل تم العثور على العنوان؟',
          labelEn: 'Was the address found?',
          required: true,
          options: [
            { value: 'YES', labelAr: 'نعم', labelEn: 'Yes' },
            { value: 'NO', labelAr: 'لا', labelEn: 'No' },
          ],
        },
        {
          key: 'addressNotFoundReason',
          type: 'LONG_TEXT',
          labelAr: 'سبب عدم العثور على العنوان',
          labelEn: 'Why the address could not be found',
          required: true,
          visibleWhen: [{ field: 'addressFound', operator: 'EQUALS', value: 'NO' }],
          validation: { minLength: 10, maxLength: 1000 },
        },
        {
          key: 'gpsLocation',
          type: 'GPS',
          labelAr: 'إحداثيات الموقع',
          labelEn: 'GPS Coordinates',
          required: true,
          hintAr: 'سجّل الإحداثيات وأنت أمام العنوان',
          hintEn: 'Record while standing at the address',
        },
      ],
    },
    {
      key: 'contact',
      titleAr: 'بيانات المقابلة',
      titleEn: 'Contact',
      visibleWhen: [{ field: 'addressFound', operator: 'EQUALS', value: 'YES' }],
      fields: [
        {
          key: 'customerFound',
          type: 'RADIO',
          labelAr: 'هل تمت مقابلة العميل؟',
          labelEn: 'Was the customer met?',
          required: true,
          options: [
            { value: 'YES', labelAr: 'نعم', labelEn: 'Yes' },
            { value: 'NO', labelAr: 'لا', labelEn: 'No' },
          ],
        },
        // The branch the brief names explicitly: when the customer was not
        // found, ask who was spoken to instead.
        {
          key: 'personContacted',
          type: 'TEXT',
          labelAr: 'اسم من تمت مقابلته',
          labelEn: 'Person contacted',
          required: true,
          visibleWhen: [{ field: 'customerFound', operator: 'EQUALS', value: 'NO' }],
          validation: { minLength: 3, maxLength: 200 },
        },
        {
          key: 'relationship',
          type: 'DROPDOWN',
          labelAr: 'صلة القرابة',
          labelEn: 'Relationship',
          required: true,
          visibleWhen: [{ field: 'customerFound', operator: 'EQUALS', value: 'NO' }],
          options: [
            { value: 'SPOUSE', labelAr: 'الزوج/الزوجة', labelEn: 'Spouse' },
            { value: 'PARENT', labelAr: 'أب/أم', labelEn: 'Parent' },
            { value: 'SIBLING', labelAr: 'أخ/أخت', labelEn: 'Sibling' },
            { value: 'CHILD', labelAr: 'ابن/ابنة', labelEn: 'Child' },
            { value: 'RELATIVE', labelAr: 'قريب', labelEn: 'Relative' },
            { value: 'NEIGHBOUR', labelAr: 'جار', labelEn: 'Neighbour' },
            { value: 'DOORMAN', labelAr: 'بواب', labelEn: 'Doorman' },
            { value: 'OTHER', labelAr: 'أخرى', labelEn: 'Other' },
          ],
        },
        {
          key: 'unavailableReason',
          type: 'LONG_TEXT',
          labelAr: 'سبب عدم تواجد العميل',
          labelEn: 'Why the customer was unavailable',
          required: true,
          visibleWhen: [{ field: 'customerFound', operator: 'EQUALS', value: 'NO' }],
          validation: { minLength: 5, maxLength: 1000 },
        },
        {
          key: 'returnDate',
          type: 'DATE',
          labelAr: 'موعد العودة المقترح',
          labelEn: 'Suggested return date',
          visibleWhen: [{ field: 'customerFound', operator: 'EQUALS', value: 'NO' }],
        },
      ],
    },
    {
      key: 'residence',
      titleAr: 'بيانات السكن',
      titleEn: 'Residence',
      visibleWhen: [{ field: 'addressFound', operator: 'EQUALS', value: 'YES' }],
      fields: [
        {
          key: 'residenceType',
          type: 'DROPDOWN',
          labelAr: 'نوع السكن',
          labelEn: 'Residence Type',
          required: true,
          options: [
            { value: 'APARTMENT', labelAr: 'شقة', labelEn: 'Apartment' },
            { value: 'VILLA', labelAr: 'فيلا', labelEn: 'Villa' },
            { value: 'DUPLEX', labelAr: 'دوبلكس', labelEn: 'Duplex' },
            { value: 'ROOM', labelAr: 'غرفة', labelEn: 'Room' },
            { value: 'OTHER', labelAr: 'أخرى', labelEn: 'Other' },
          ],
          width: 6,
        },
        {
          key: 'ownership',
          type: 'RADIO',
          labelAr: 'ملكية السكن',
          labelEn: 'Ownership',
          required: true,
          options: [
            { value: 'OWNED', labelAr: 'ملك', labelEn: 'Owned' },
            { value: 'RENTED', labelAr: 'إيجار', labelEn: 'Rented' },
            { value: 'FAMILY', labelAr: 'ملك العائلة', labelEn: 'Family owned' },
          ],
          width: 6,
        },
        {
          key: 'yearsAtAddress',
          type: 'NUMBER',
          labelAr: 'عدد سنوات الإقامة',
          labelEn: 'Years at this address',
          validation: { min: 0, max: 100 },
          width: 6,
        },
        {
          key: 'floorNumber',
          type: 'NUMBER',
          labelAr: 'رقم الدور',
          labelEn: 'Floor number',
          validation: { min: 0, max: 60 },
          width: 6,
        },
        {
          key: 'buildingCondition',
          type: 'RATING',
          labelAr: 'تقييم حالة المبنى',
          labelEn: 'Building condition',
          scale: 5,
          required: true,
        },
        {
          key: 'addressMatches',
          type: 'RADIO',
          labelAr: 'هل يطابق العنوان بيانات الطلب؟',
          labelEn: 'Does the address match the application?',
          required: true,
          options: [
            { value: 'YES', labelAr: 'مطابق', labelEn: 'Matches' },
            { value: 'PARTIAL', labelAr: 'مطابق جزئيًا', labelEn: 'Partially matches' },
            { value: 'NO', labelAr: 'غير مطابق', labelEn: 'Does not match' },
          ],
        },
        {
          key: 'correctedAddress',
          type: 'ADDRESS',
          labelAr: 'العنوان الصحيح',
          labelEn: 'Corrected address',
          required: true,
          visibleWhen: [
            { field: 'addressMatches', operator: 'IN', value: ['PARTIAL', 'NO'] },
          ],
          validation: { minLength: 10, maxLength: 500 },
        },
      ],
    },
    {
      key: 'evidence',
      titleAr: 'الأدلة',
      titleEn: 'Evidence',
      fields: [
        {
          key: 'residenceFrontPhoto',
          type: 'PHOTO',
          labelAr: 'صورة واجهة السكن',
          labelEn: 'Residence front photo',
          required: true,
          mediaCategoryCode: 'RESIDENCE_FRONT',
          minCount: 1,
          maxCount: 3,
        },
        {
          key: 'entrancePhoto',
          type: 'PHOTO',
          labelAr: 'صورة المدخل',
          labelEn: 'Entrance photo',
          required: true,
          mediaCategoryCode: 'RESIDENCE_ENTRANCE',
          minCount: 1,
          maxCount: 2,
        },
        {
          key: 'streetPhoto',
          type: 'PHOTO',
          labelAr: 'صورة الشارع',
          labelEn: 'Street photo',
          mediaCategoryCode: 'STREET_VIEW',
          maxCount: 2,
        },
        {
          key: 'customerSignature',
          type: 'SIGNATURE',
          labelAr: 'توقيع من تمت مقابلته',
          labelEn: 'Signature of the person met',
          mediaCategoryCode: 'SIGNATURE',
        },
      ],
    },
    {
      key: 'conclusion',
      titleAr: 'الخلاصة',
      titleEn: 'Conclusion',
      fields: [
        {
          key: 'recommendation',
          type: 'RADIO',
          labelAr: 'التوصية',
          labelEn: 'Recommendation',
          required: true,
          options: [
            { value: 'POSITIVE', labelAr: 'إيجابي', labelEn: 'Positive' },
            { value: 'NEGATIVE', labelAr: 'سلبي', labelEn: 'Negative' },
            { value: 'INCONCLUSIVE', labelAr: 'غير حاسم', labelEn: 'Inconclusive' },
          ],
        },
        {
          key: 'investigatorNotes',
          type: 'LONG_TEXT',
          labelAr: 'ملاحظات الباحث',
          labelEn: 'Investigator notes',
          validation: { maxLength: 2000 },
        },
      ],
    },
  ],
};

export const WORKPLACE_FORM_SCHEMA: FormSchema = {
  sections: [
    {
      key: 'visit',
      titleAr: 'بيانات الزيارة',
      titleEn: 'Visit Details',
      fields: [
        {
          key: 'visitDate',
          type: 'DATE',
          labelAr: 'تاريخ الزيارة',
          labelEn: 'Visit Date',
          required: true,
          width: 6,
        },
        {
          key: 'workplaceFound',
          type: 'RADIO',
          labelAr: 'هل تم العثور على جهة العمل؟',
          labelEn: 'Was the workplace found?',
          required: true,
          options: [
            { value: 'YES', labelAr: 'نعم', labelEn: 'Yes' },
            { value: 'NO', labelAr: 'لا', labelEn: 'No' },
          ],
        },
        {
          key: 'gpsLocation',
          type: 'GPS',
          labelAr: 'إحداثيات الموقع',
          labelEn: 'GPS Coordinates',
          required: true,
        },
      ],
    },
    {
      key: 'employment',
      titleAr: 'بيانات التوظيف',
      titleEn: 'Employment',
      visibleWhen: [{ field: 'workplaceFound', operator: 'EQUALS', value: 'YES' }],
      fields: [
        {
          key: 'employmentConfirmed',
          type: 'RADIO',
          labelAr: 'هل تم تأكيد عمل العميل؟',
          labelEn: 'Was employment confirmed?',
          required: true,
          options: [
            { value: 'YES', labelAr: 'نعم', labelEn: 'Yes' },
            { value: 'NO', labelAr: 'لا', labelEn: 'No' },
          ],
        },
        {
          key: 'confirmedBy',
          type: 'TEXT',
          labelAr: 'اسم من أكد المعلومة',
          labelEn: 'Confirmed by',
          required: true,
          visibleWhen: [
            { field: 'employmentConfirmed', operator: 'EQUALS', value: 'YES' },
          ],
          validation: { minLength: 3, maxLength: 200 },
        },
        {
          key: 'confirmerRole',
          type: 'DROPDOWN',
          labelAr: 'صفة من أكد المعلومة',
          labelEn: 'Their role',
          required: true,
          visibleWhen: [
            { field: 'employmentConfirmed', operator: 'EQUALS', value: 'YES' },
          ],
          options: [
            { value: 'HR', labelAr: 'الموارد البشرية', labelEn: 'Human Resources' },
            { value: 'MANAGER', labelAr: 'مدير مباشر', labelEn: 'Direct manager' },
            { value: 'OWNER', labelAr: 'صاحب العمل', labelEn: 'Business owner' },
            { value: 'COLLEAGUE', labelAr: 'زميل', labelEn: 'Colleague' },
            { value: 'SECURITY', labelAr: 'الأمن', labelEn: 'Security' },
          ],
        },
        {
          key: 'jobTitle',
          type: 'TEXT',
          labelAr: 'المسمى الوظيفي',
          labelEn: 'Job title',
          visibleWhen: [
            { field: 'employmentConfirmed', operator: 'EQUALS', value: 'YES' },
          ],
          validation: { maxLength: 120 },
          width: 6,
        },
        {
          key: 'yearsEmployed',
          type: 'NUMBER',
          labelAr: 'عدد سنوات الخدمة',
          labelEn: 'Years employed',
          visibleWhen: [
            { field: 'employmentConfirmed', operator: 'EQUALS', value: 'YES' },
          ],
          validation: { min: 0, max: 60 },
          width: 6,
        },
        {
          key: 'notConfirmedReason',
          type: 'LONG_TEXT',
          labelAr: 'سبب عدم التأكيد',
          labelEn: 'Why it could not be confirmed',
          required: true,
          visibleWhen: [
            { field: 'employmentConfirmed', operator: 'EQUALS', value: 'NO' },
          ],
          validation: { minLength: 10, maxLength: 1000 },
        },
      ],
    },
    {
      key: 'business',
      titleAr: 'بيانات المنشأة',
      titleEn: 'Business Details',
      visibleWhen: [{ field: 'workplaceFound', operator: 'EQUALS', value: 'YES' }],
      fields: [
        {
          key: 'businessType',
          type: 'DROPDOWN',
          labelAr: 'نوع النشاط',
          labelEn: 'Business type',
          options: [
            { value: 'OFFICE', labelAr: 'مكتب', labelEn: 'Office' },
            { value: 'FACTORY', labelAr: 'مصنع', labelEn: 'Factory' },
            { value: 'SHOP', labelAr: 'محل تجاري', labelEn: 'Retail shop' },
            { value: 'CLINIC', labelAr: 'عيادة', labelEn: 'Clinic' },
            { value: 'GOVERNMENT', labelAr: 'جهة حكومية', labelEn: 'Government' },
            { value: 'OTHER', labelAr: 'أخرى', labelEn: 'Other' },
          ],
          width: 6,
        },
        {
          key: 'approxStaffCount',
          type: 'NUMBER',
          labelAr: 'عدد الموظفين التقريبي',
          labelEn: 'Approximate staff count',
          validation: { min: 1, max: 100000 },
          width: 6,
        },
        {
          key: 'workingHours',
          type: 'TEXT',
          labelAr: 'مواعيد العمل',
          labelEn: 'Working hours',
          validation: { maxLength: 120 },
        },
      ],
    },
    {
      key: 'evidence',
      titleAr: 'الأدلة',
      titleEn: 'Evidence',
      fields: [
        {
          key: 'workplaceFrontPhoto',
          type: 'PHOTO',
          labelAr: 'صورة واجهة جهة العمل',
          labelEn: 'Workplace front photo',
          required: true,
          mediaCategoryCode: 'WORKPLACE_FRONT',
          minCount: 1,
          maxCount: 3,
        },
        {
          key: 'workplaceInteriorPhoto',
          type: 'PHOTO',
          labelAr: 'صورة داخلية',
          labelEn: 'Interior photo',
          mediaCategoryCode: 'WORKPLACE_INTERIOR',
          maxCount: 3,
        },
      ],
    },
    {
      key: 'conclusion',
      titleAr: 'الخلاصة',
      titleEn: 'Conclusion',
      fields: [
        {
          key: 'recommendation',
          type: 'RADIO',
          labelAr: 'التوصية',
          labelEn: 'Recommendation',
          required: true,
          options: [
            { value: 'POSITIVE', labelAr: 'إيجابي', labelEn: 'Positive' },
            { value: 'NEGATIVE', labelAr: 'سلبي', labelEn: 'Negative' },
            { value: 'INCONCLUSIVE', labelAr: 'غير حاسم', labelEn: 'Inconclusive' },
          ],
        },
        {
          key: 'investigatorNotes',
          type: 'LONG_TEXT',
          labelAr: 'ملاحظات الباحث',
          labelEn: 'Investigator notes',
          validation: { maxLength: 2000 },
        },
      ],
    },
  ],
};
