'use strict';
const { incidentDateTime } = require('./incident-message-copy');
const { can, serviceEntitlements } = require('./family-policy');

function incidentReadingParameters(snapshot, timeZone) {
  const readings = snapshot?.readings || {};
  const time = reading => `received ${incidentDateTime(reading.receivedAt, timeZone)}`;
  const heart = readings.heartBloodPressure, oxygen = readings.oxygen, temperature = readings.temperature;
  return [
    heart ? `Heart rate: ${heart.values.heartRateBpm} bpm · ${time(heart)}` : 'Heart rate: no fresh reading received.',
    oxygen ? `Oxygen estimate: ${oxygen.values.spo2Percent}% · ${time(oxygen)}` : 'Oxygen: no fresh reading received.',
    heart ? `Blood pressure estimate: ${heart.values.systolicMmHg}/${heart.values.diastolicMmHg} mmHg · ${time(heart)}` : 'Blood pressure: no fresh reading received.',
    temperature ? `Skin temperature estimate: ${temperature.values.skinTemperatureCelsius.toFixed(2)} °C · ${time(temperature)}` : 'Skin temperature: no fresh reading received.',
  ];
}

// A saved emergency-contact number is not proof of permission to disclose
// health readings. Bind the destination to a currently verified member.
async function canSendIncidentReadings(db, incident, contact, now = Date.now()) {
  if (!contact?.guardianUid) return false;
  const [serviceDoc, channelDoc] = await Promise.all([
    db.collection('familyServices').doc(incident.imei).get(),
    db.collection('familyChannels').doc(contact.guardianUid).get(),
  ]);
  const service = serviceDoc.data(), channel = channelDoc.data();
  const member = service?.members?.[contact.guardianUid];
  return service?.ownerUid === incident.ownerUid && serviceEntitlements(service, now).serviceActive &&
    can(service, contact.guardianUid, 'wellbeing', now) && can(service, contact.guardianUid, 'alerts', now) &&
    member?.whatsapp === true && member.whatsappConsent === true &&
    !!channel?.verifiedAtMs && channel.phone === (contact.whatsapp || contact.phone);
}

module.exports = { incidentReadingParameters, canSendIncidentReadings };
