/**
 * Egypt's administrative geography.
 *
 * A working subset, not the complete gazetteer: every governorate, the cities
 * that carry real field-investigation volume, and districts for Cairo, Giza
 * and Alexandria where a coordinator genuinely assigns at that level. A full
 * district list for all 27 governorates is a data-loading exercise, not a
 * software one, and this is enough to exercise coverage matching, the live map
 * and the import lookups honestly.
 *
 * Codes follow ISO 3166-2:EG where one exists, so the catalogue can be
 * reconciled against an external source later without renaming anything.
 */

export interface SeedDistrict {
  code: string;
  nameAr: string;
  nameEn: string;
  areas?: { code: string; nameAr: string; nameEn: string }[];
}

export interface SeedCity {
  code: string;
  nameAr: string;
  nameEn: string;
  districts?: SeedDistrict[];
}

export interface SeedGovernorate {
  code: string;
  nameAr: string;
  nameEn: string;
  cities: SeedCity[];
}

export const EGYPT_GEOGRAPHY: SeedGovernorate[] = [
  {
    code: 'C',
    nameAr: 'القاهرة',
    nameEn: 'Cairo',
    cities: [
      {
        code: 'NASR_CITY',
        nameAr: 'مدينة نصر',
        nameEn: 'Nasr City',
        districts: [
          {
            code: 'ZONE_1',
            nameAr: 'الحي الأول',
            nameEn: 'First Zone',
            areas: [
              { code: 'ABBAS_ELAKKAD', nameAr: 'عباس العقاد', nameEn: 'Abbas El Akkad' },
              { code: 'MAKRAM_EBEID', nameAr: 'مكرم عبيد', nameEn: 'Makram Ebeid' },
            ],
          },
          { code: 'ZONE_6', nameAr: 'الحي السادس', nameEn: 'Sixth Zone' },
          { code: 'ZONE_8', nameAr: 'الحي الثامن', nameEn: 'Eighth Zone' },
        ],
      },
      {
        code: 'HELIOPOLIS',
        nameAr: 'مصر الجديدة',
        nameEn: 'Heliopolis',
        districts: [
          { code: 'KORBA', nameAr: 'الكوربة', nameEn: 'Korba' },
          { code: 'ROXY', nameAr: 'روكسي', nameEn: 'Roxy' },
          { code: 'ALMAZA', nameAr: 'ألماظة', nameEn: 'Almaza' },
        ],
      },
      {
        code: 'MAADI',
        nameAr: 'المعادي',
        nameEn: 'Maadi',
        districts: [
          { code: 'DEGLA', nameAr: 'دجلة', nameEn: 'Degla' },
          { code: 'ZAHRAA_MAADI', nameAr: 'زهراء المعادي', nameEn: 'Zahraa El Maadi' },
          { code: 'OLD_MAADI', nameAr: 'المعادي القديمة', nameEn: 'Old Maadi' },
        ],
      },
      {
        code: 'NEW_CAIRO',
        nameAr: 'القاهرة الجديدة',
        nameEn: 'New Cairo',
        districts: [
          { code: 'FIRST_SETTLEMENT', nameAr: 'التجمع الأول', nameEn: 'First Settlement' },
          { code: 'FIFTH_SETTLEMENT', nameAr: 'التجمع الخامس', nameEn: 'Fifth Settlement' },
          { code: 'REHAB', nameAr: 'الرحاب', nameEn: 'Rehab City' },
          { code: 'MADINATY', nameAr: 'مدينتي', nameEn: 'Madinaty' },
        ],
      },
      {
        code: 'SHOUBRA',
        nameAr: 'شبرا',
        nameEn: 'Shoubra',
        districts: [
          { code: 'ROD_ELFARAG', nameAr: 'روض الفرج', nameEn: 'Rod El Farag' },
          { code: 'SAHEL', nameAr: 'الساحل', nameEn: 'El Sahel' },
        ],
      },
      { code: 'DOWNTOWN', nameAr: 'وسط البلد', nameEn: 'Downtown' },
      { code: 'ZAMALEK', nameAr: 'الزمالك', nameEn: 'Zamalek' },
      { code: 'HELWAN', nameAr: 'حلوان', nameEn: 'Helwan' },
      { code: 'AIN_SHAMS', nameAr: 'عين شمس', nameEn: 'Ain Shams' },
    ],
  },
  {
    code: 'GZ',
    nameAr: 'الجيزة',
    nameEn: 'Giza',
    cities: [
      {
        code: 'DOKKI',
        nameAr: 'الدقي',
        nameEn: 'Dokki',
        districts: [
          { code: 'MESSAHA', nameAr: 'المساحة', nameEn: 'El Messaha' },
          { code: 'TAHRIR_ST', nameAr: 'شارع التحرير', nameEn: 'Tahrir Street' },
        ],
      },
      {
        code: 'MOHANDESSIN',
        nameAr: 'المهندسين',
        nameEn: 'Mohandessin',
        districts: [
          { code: 'ARAB_LEAGUE', nameAr: 'جامعة الدول العربية', nameEn: 'Arab League Street' },
          { code: 'SPHINX', nameAr: 'ميدان سفنكس', nameEn: 'Sphinx Square' },
        ],
      },
      {
        code: 'SIX_OCTOBER',
        nameAr: 'مدينة 6 أكتوبر',
        nameEn: '6th of October City',
        districts: [
          { code: 'DISTRICT_1', nameAr: 'الحي الأول', nameEn: 'District 1' },
          { code: 'DISTRICT_7', nameAr: 'الحي السابع', nameEn: 'District 7' },
          { code: 'SHEIKH_ZAYED', nameAr: 'الشيخ زايد', nameEn: 'Sheikh Zayed' },
        ],
      },
      { code: 'HARAM', nameAr: 'الهرم', nameEn: 'Haram' },
      { code: 'FAISAL', nameAr: 'فيصل', nameEn: 'Faisal' },
      { code: 'IMBABA', nameAr: 'إمبابة', nameEn: 'Imbaba' },
      { code: 'BADRASHIN', nameAr: 'البدرشين', nameEn: 'Badrashin' },
    ],
  },
  {
    code: 'ALX',
    nameAr: 'الإسكندرية',
    nameEn: 'Alexandria',
    cities: [
      {
        code: 'MONTAZA',
        nameAr: 'المنتزه',
        nameEn: 'Montazah',
        districts: [
          { code: 'MIAMI', nameAr: 'ميامي', nameEn: 'Miami' },
          { code: 'SIDI_BISHR', nameAr: 'سيدي بشر', nameEn: 'Sidi Bishr' },
        ],
      },
      {
        code: 'SMOUHA',
        nameAr: 'سموحة',
        nameEn: 'Smouha',
        districts: [
          { code: 'FAWZY_MOAZ', nameAr: 'فوزي معاذ', nameEn: 'Fawzy Moaz' },
        ],
      },
      { code: 'SIDI_GABER', nameAr: 'سيدي جابر', nameEn: 'Sidi Gaber' },
      { code: 'AGAMY', nameAr: 'العجمي', nameEn: 'Agamy' },
      { code: 'BORG_ELARAB', nameAr: 'برج العرب', nameEn: 'Borg El Arab' },
    ],
  },
  {
    code: 'DK',
    nameAr: 'الدقهلية',
    nameEn: 'Dakahlia',
    cities: [
      { code: 'MANSOURA', nameAr: 'المنصورة', nameEn: 'Mansoura' },
      { code: 'MIT_GHAMR', nameAr: 'ميت غمر', nameEn: 'Mit Ghamr' },
      { code: 'TALKHA', nameAr: 'طلخا', nameEn: 'Talkha' },
    ],
  },
  {
    code: 'SHR',
    nameAr: 'الشرقية',
    nameEn: 'Sharqia',
    cities: [
      { code: 'ZAGAZIG', nameAr: 'الزقازيق', nameEn: 'Zagazig' },
      { code: 'BILBEIS', nameAr: 'بلبيس', nameEn: 'Bilbeis' },
      { code: 'TENTH_RAMADAN', nameAr: 'العاشر من رمضان', nameEn: '10th of Ramadan' },
    ],
  },
  {
    code: 'GH',
    nameAr: 'الغربية',
    nameEn: 'Gharbia',
    cities: [
      { code: 'TANTA', nameAr: 'طنطا', nameEn: 'Tanta' },
      { code: 'MAHALLA', nameAr: 'المحلة الكبرى', nameEn: 'El Mahalla El Kubra' },
    ],
  },
  {
    code: 'MNF',
    nameAr: 'المنوفية',
    nameEn: 'Menofia',
    cities: [
      { code: 'SHEBIN_ELKOM', nameAr: 'شبين الكوم', nameEn: 'Shebin El Kom' },
      { code: 'SADAT_CITY', nameAr: 'مدينة السادات', nameEn: 'Sadat City' },
    ],
  },
  {
    code: 'BH',
    nameAr: 'البحيرة',
    nameEn: 'Beheira',
    cities: [
      { code: 'DAMANHOUR', nameAr: 'دمنهور', nameEn: 'Damanhour' },
      { code: 'KAFR_ELDAWAR', nameAr: 'كفر الدوار', nameEn: 'Kafr El Dawar' },
    ],
  },
  {
    code: 'KFS',
    nameAr: 'كفر الشيخ',
    nameEn: 'Kafr El Sheikh',
    cities: [{ code: 'KAFR_ELSHEIKH', nameAr: 'كفر الشيخ', nameEn: 'Kafr El Sheikh' }],
  },
  {
    code: 'DT',
    nameAr: 'دمياط',
    nameEn: 'Damietta',
    cities: [
      { code: 'DAMIETTA', nameAr: 'دمياط', nameEn: 'Damietta' },
      { code: 'NEW_DAMIETTA', nameAr: 'دمياط الجديدة', nameEn: 'New Damietta' },
    ],
  },
  {
    code: 'PTS',
    nameAr: 'بورسعيد',
    nameEn: 'Port Said',
    cities: [{ code: 'PORT_SAID', nameAr: 'بورسعيد', nameEn: 'Port Said' }],
  },
  {
    code: 'IS',
    nameAr: 'الإسماعيلية',
    nameEn: 'Ismailia',
    cities: [{ code: 'ISMAILIA', nameAr: 'الإسماعيلية', nameEn: 'Ismailia' }],
  },
  {
    code: 'SUZ',
    nameAr: 'السويس',
    nameEn: 'Suez',
    cities: [{ code: 'SUEZ', nameAr: 'السويس', nameEn: 'Suez' }],
  },
  {
    code: 'BNS',
    nameAr: 'بني سويف',
    nameEn: 'Beni Suef',
    cities: [{ code: 'BENI_SUEF', nameAr: 'بني سويف', nameEn: 'Beni Suef' }],
  },
  {
    code: 'FYM',
    nameAr: 'الفيوم',
    nameEn: 'Fayoum',
    cities: [{ code: 'FAYOUM', nameAr: 'الفيوم', nameEn: 'Fayoum' }],
  },
  {
    code: 'MN',
    nameAr: 'المنيا',
    nameEn: 'Minya',
    cities: [{ code: 'MINYA', nameAr: 'المنيا', nameEn: 'Minya' }],
  },
  {
    code: 'AST',
    nameAr: 'أسيوط',
    nameEn: 'Asyut',
    cities: [{ code: 'ASYUT', nameAr: 'أسيوط', nameEn: 'Asyut' }],
  },
  {
    code: 'SHG',
    nameAr: 'سوهاج',
    nameEn: 'Sohag',
    cities: [{ code: 'SOHAG', nameAr: 'سوهاج', nameEn: 'Sohag' }],
  },
  {
    code: 'QNA',
    nameAr: 'قنا',
    nameEn: 'Qena',
    cities: [{ code: 'QENA', nameAr: 'قنا', nameEn: 'Qena' }],
  },
  {
    code: 'LX',
    nameAr: 'الأقصر',
    nameEn: 'Luxor',
    cities: [{ code: 'LUXOR', nameAr: 'الأقصر', nameEn: 'Luxor' }],
  },
  {
    code: 'ASN',
    nameAr: 'أسوان',
    nameEn: 'Aswan',
    cities: [{ code: 'ASWAN', nameAr: 'أسوان', nameEn: 'Aswan' }],
  },
  {
    code: 'BA',
    nameAr: 'البحر الأحمر',
    nameEn: 'Red Sea',
    cities: [
      { code: 'HURGHADA', nameAr: 'الغردقة', nameEn: 'Hurghada' },
      { code: 'SAFAGA', nameAr: 'سفاجا', nameEn: 'Safaga' },
    ],
  },
  {
    code: 'MT',
    nameAr: 'مطروح',
    nameEn: 'Matrouh',
    cities: [{ code: 'MARSA_MATROUH', nameAr: 'مرسى مطروح', nameEn: 'Marsa Matrouh' }],
  },
  {
    code: 'WAD',
    nameAr: 'الوادي الجديد',
    nameEn: 'New Valley',
    cities: [{ code: 'KHARGA', nameAr: 'الخارجة', nameEn: 'Kharga' }],
  },
  {
    code: 'SIN',
    nameAr: 'شمال سيناء',
    nameEn: 'North Sinai',
    cities: [{ code: 'ARISH', nameAr: 'العريش', nameEn: 'Arish' }],
  },
  {
    code: 'JS',
    nameAr: 'جنوب سيناء',
    nameEn: 'South Sinai',
    cities: [
      { code: 'SHARM_ELSHEIKH', nameAr: 'شرم الشيخ', nameEn: 'Sharm El Sheikh' },
      { code: 'DAHAB', nameAr: 'دهب', nameEn: 'Dahab' },
    ],
  },
  {
    code: 'KB',
    nameAr: 'القليوبية',
    nameEn: 'Qalyubia',
    cities: [
      { code: 'BANHA', nameAr: 'بنها', nameEn: 'Banha' },
      { code: 'SHUBRA_ELKHEIMA', nameAr: 'شبرا الخيمة', nameEn: 'Shubra El Kheima' },
      { code: 'QALYUB', nameAr: 'قليوب', nameEn: 'Qalyub' },
    ],
  },
];
