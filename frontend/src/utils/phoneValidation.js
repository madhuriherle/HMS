import { parsePhoneNumberFromString, isValidPhoneNumber, isPossiblePhoneNumber } from 'libphonenumber-js';
import { COUNTRY_CODES } from './countryCodes';

/**
 * Validates a national phone number against a selected country code.
 * @param {string} rawNumber - The national number entered by the user
 * @param {string} countryIso - The ISO-2 country code (e.g. 'IN', 'US', 'GB')
 * @param {string} dialCode - The dial code (e.g. '+91', '+1')
 * @returns {{ isValid: boolean, errorMsg: string, formattedNational: string, e164: string }}
 */
export function validateInternationalPhone(rawNumber, countryIso = 'IN', dialCode = '+91') {
  if (!rawNumber || !rawNumber.trim()) {
    return {
      isValid: false,
      errorMsg: 'Phone number is required',
      formattedNational: '',
      e164: ''
    };
  }

  // Clean raw digits
  let cleanNumber = rawNumber.trim().replace(/[^\d+]/g, '');

  // Strip duplicate dialCode if user accidentally typed it into the number input
  const numericDial = dialCode.replace(/\+/g, '');
  if (cleanNumber.startsWith('+' + numericDial)) {
    cleanNumber = cleanNumber.slice(('+' + numericDial).length);
  } else if (cleanNumber.startsWith(numericDial) && cleanNumber.length > numericDial.length + 6) {
    cleanNumber = cleanNumber.slice(numericDial.length);
  }

  // Find country name for friendly error messaging
  const countryObj = COUNTRY_CODES.find((c) => c.code === countryIso) || { name: 'selected country' };

  try {
    // Attempt parse with libphonenumber-js
    const parsed = parsePhoneNumberFromString(cleanNumber, countryIso);

    if (!parsed) {
      return {
        isValid: false,
        errorMsg: `Please enter a valid phone number for ${countryObj.name} (${dialCode})`,
        formattedNational: cleanNumber,
        e164: `${dialCode}${cleanNumber}`
      };
    }

    if (!parsed.isValid()) {
      // Check if it's too short, too long, or invalid format
      const possible = isPossiblePhoneNumber(cleanNumber, countryIso);
      let reason = `Invalid phone number format for ${countryObj.name} (${dialCode})`;
      if (!possible) {
        if (cleanNumber.length < 5) {
          reason = `Phone number is too short for ${countryObj.name}`;
        } else if (cleanNumber.length > 15) {
          reason = `Phone number is too long for ${countryObj.name}`;
        }
      }
      return {
        isValid: false,
        errorMsg: reason,
        formattedNational: parsed.nationalNumber || cleanNumber,
        e164: parsed.number || `${dialCode}${cleanNumber}`
      };
    }

    return {
      isValid: true,
      errorMsg: '',
      formattedNational: parsed.nationalNumber,
      e164: parsed.number
    };
  } catch {
    return {
      isValid: false,
      errorMsg: `Invalid phone number for ${countryObj.name} (${dialCode})`,
      formattedNational: cleanNumber,
      e164: `${dialCode}${cleanNumber}`
    };
  }
}
