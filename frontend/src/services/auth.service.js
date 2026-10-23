import api from './api'

export const registerUser = (payload) => {
  return api.post('/auth/register', payload).then(res => res.data)
}

export const verifyEmailOtp = (verificationToken, otp) => {
  return api.post('/auth/verify-email-otp', { verificationToken, otp }).then(res => res.data)
}

export const resendEmailVerificationOtp = (verificationToken) => {
  return api.post('/auth/resend-otp', { purpose: 'EMAIL_VERIFICATION', verificationToken }).then(res => res.data)
}

export const getPendingRegistration = () => {
  return api.get('/auth/pending-registration').then(res => res.data)
}

export const loginUser = (identifier, password) => {
  return api.post('/auth/login', { identifier, password }).then(res => res.data)
}

export const logoutUser = () => {
  return api.post('/auth/logout').then(res => res.data)
}

export const getCurrentUser = () => {
  return api.get('/auth/me').then(res => res.data)
}

export const requestPasswordReset = (email) => {
  return api.post('/auth/forgot-password', { email }).then(res => res.data)
}

export const resendPasswordResetOtp = (email) => {
  return api.post('/auth/resend-otp', { purpose: 'PASSWORD_RESET', email }).then(res => res.data)
}

export const verifyPasswordResetOtp = (email, otp) => {
  return api.post('/auth/verify-reset-otp', { email, otp }).then(res => res.data)
}

export const resetPassword = (resetToken, newPassword, confirmNewPassword) => {
  return api.post('/auth/reset-password', { resetToken, newPassword, confirmNewPassword }).then(res => res.data)
}

export const changePassword = (currentPassword, newPassword, confirmNewPassword) => {
  return api.post('/auth/change-password', { currentPassword, newPassword, confirmNewPassword }).then(res => res.data)
}

export const uploadAvatar = (avatar) => {
  return api.put('/auth/avatar', { avatar }).then(res => res.data)
}

export const requestEmailChange = (newEmail) => {
  return api.post('/auth/request-email-change', { newEmail }).then(res => res.data)
}

export const resendEmailChangeOtp = (changeToken) => {
  return api.post('/auth/resend-email-change-otp', { changeToken }).then(res => res.data)
}

export const verifyEmailChange = (changeToken, otp) => {
  return api.post('/auth/verify-email-change', { changeToken, otp }).then(res => res.data)
}