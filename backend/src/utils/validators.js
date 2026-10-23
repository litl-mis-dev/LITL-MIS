// Student number format: YYYY-NNN-N (third part has no fixed length)
const STUDENT_NUMBER_REGEX = /^\d{4}-(100|200)-\d+$/

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const CVSU_EMAIL_REGEX = /^[^\s@]+@cvsu\.edu\.ph$/

const VALID_SEX_VALUES = ['MALE', 'FEMALE',"PREFER_NOT_TO_SAY"]

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#_-])[A-Za-z\d@$!%*?&.#_-]{8,}$/

const NAME_REGEX = /^[A-Za-z\s'-]+$/

//const SECTION_REGEX = /^\d{2}$/
const SECTION_REGEX = /^(?:[1-9]|[1-9]\d)$/

const VALID_YEAR_LEVELS = ['1st Year', '2nd Year', '3rd Year', '4th Year']

const isValidStudentNumber = (value) => {
  return typeof value === 'string' &&
    STUDENT_NUMBER_REGEX.test(value)
}

const isValidEmail = (value) => {
  return typeof value === 'string' &&
    EMAIL_REGEX.test(value)
}

const isCvsuEmail = (value) => {
  return typeof value === 'string' &&
    CVSU_EMAIL_REGEX.test(value)
}

const isValidPassword = (value) => {
  return typeof value === 'string' && PASSWORD_REGEX.test(value)
}

const isValidSex = (value) => {
  return VALID_SEX_VALUES.includes(value)
}

const isValidName = (value) => {
  return typeof value === 'string'
    && value.trim().length >= 2
    && value.trim().length <= 30
    && NAME_REGEX.test(value.trim())
}

const isValidSection = (value) => {
  return typeof value === 'string'
    && SECTION_REGEX.test(value.trim())
}

const isValidYearLevel = (value) => {
  return VALID_YEAR_LEVELS.includes(String(value))
}

const VALID_MEMBER_STATUSES = ['ACTIVE', 'INACTIVE', 'GRADUATED', 'ARCHIVED']

function isValidMemberStatus(status) {
  return VALID_MEMBER_STATUSES.includes(status)
}

module.exports = {
  isValidStudentNumber,
  isValidEmail,
  isCvsuEmail,
  isValidPassword,
  isValidSex,
  isValidName,
  isValidSection,
  VALID_MEMBER_STATUSES,
  isValidYearLevel
}