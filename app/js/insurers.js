// Insurers with a published Patient Access API (CMS interoperability rule), as stated in each insurer's own developer materials.
// "covers" repeats what the insurer says; employer (commercial) plans are often not included.
export const INSURERS = [
  { id: "aetna", name: "Aetna", member: "https://www.aetna.com", dev: "https://developerportal.aetna.com/",
    covers: "Medicare, Medicaid and some fully insured commercial plans (Aetna names California and Tennessee).", herepup: "Registration with Aetna in progress" },
  { id: "uhc", name: "UnitedHealthcare", member: "https://www.myuhc.com", dev: "https://flex.optum.com/portal/homepage",
    covers: "UnitedHealthcare, Sierra Health and Life, Rocky Mountain Health Plans and Peoples Health members. Plan types aren't stated.", herepup: "Not registered yet" },
  { id: "cigna", name: "Cigna", member: "https://www.mycigna.com", dev: "https://developer.cigna.com/",
    covers: "Cigna's public pages don't state which plan types are included.", herepup: "Not registered yet" },
  { id: "anthem", name: "Anthem (Elevance Health)", member: "https://www.anthem.com", dev: "https://www.anthem.com/developers",
    covers: "Anthem says all lines of business, including commercial plans, Medicaid and ACA exchange plans.", herepup: "Not registered yet" },
  { id: "humana", name: "Humana", member: "https://www.humana.com", dev: "https://developers.humana.com/",
    covers: "Humana's public pages don't state which plan types are included.", herepup: "Not registered yet" },
  { id: "carefirst", name: "CareFirst BlueCross BlueShield", member: "https://member.carefirst.com", dev: "https://developer.carefirst.com/",
    covers: "CareFirst's public pages don't state which plan types are included.", herepup: "Not registered yet" },
  { id: "ibx", name: "Independence Blue Cross", member: "https://www.ibx.com", dev: "https://devportal.ibx.com/",
    covers: "Independence's public pages don't state which plan types are included.", herepup: "Not registered yet" },
  { id: "bcbsnc", name: "Blue Cross NC", member: "https://www.bluecrossnc.com", dev: "https://appregister.bluecrossnc.com/s/login/",
    covers: "Blue Cross NC names Medicare and ACA plans; employer plans aren't mentioned.", herepup: "Not registered yet" },
  { id: "medicare", name: "Original Medicare (Blue Button 2.0)", member: "https://www.medicare.gov", dev: "https://bluebutton.cms.gov/",
    covers: "People with Original Medicare: Part A, Part B and Part D claims.", herepup: "Not registered yet" },
  { id: "other", name: "Another insurer", member: "", dev: "", covers: "", herepup: "" },
];
