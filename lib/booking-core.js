'use strict';

const ALLOWED_CHANNELS = new Set(['telegram', 'whatsapp', 'phone']);
const CHANNEL_LABELS = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  phone: 'Звонок администратора',
};

const ALLOWED_TIME_SLOTS = new Set([
  '10:00–13:00',
  '13:00–17:00',
  '17:00–21:00',
]);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getNovosibirskTodayIso() {
  const nskNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return nskNow.toISOString().slice(0, 10);
}

function normalizeTimeSlot(raw) {
  return String(raw ?? '').trim().replace(/-/g, '–');
}

function validateBookingPayload(rawBody) {
  const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
  const fields = {};

  const honeypot = typeof body.company === 'string' ? body.company.trim() : '';
  if (honeypot.length > 0) {
    return { isSpam: true, fields: {}, data: null };
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const phoneDigits = phone.replace(/\D/g, '');
  const rawService = typeof body.service === 'string' ? body.service.trim() : '';
  const rawMaster = typeof body.master === 'string' ? body.master.trim() : '';
  const service = rawService || 'Подбор на консультации';
  const master = rawMaster || 'Любой свободный мастер';
  const promo = body.promo === true || body.promo === 'true' || body.promo === 'on';
  const consent = body.consent === true || body.consent === 'true' || body.consent === 'on';

  // Future-ready optional fields: validated only when explicitly provided
  const channel = typeof body.channel === 'string' ? body.channel.trim() : '';
  const rawTelegram = typeof body.telegram === 'string' ? body.telegram.trim() : '';
  const telegram = rawTelegram ? `@${rawTelegram.replace(/^@+/, '')}` : '';
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  const rawTimeSlot = typeof body.timeSlot === 'string' ? body.timeSlot.trim() : '';
  const timeSlot = rawTimeSlot ? normalizeTimeSlot(rawTimeSlot) : '';

  if (name.length < 2 || name.length > 80) {
    fields.name = 'Укажите ваше имя (минимум 2 символа)';
  }

  if (phoneDigits.length !== 11 || (phoneDigits[0] !== '7' && phoneDigits[0] !== '8')) {
    fields.phone = 'Введите корректный российский номер телефона';
  }

  if (rawService.length > 140) {
    fields.service = 'Выберите процедуру из меню';
  }

  if (rawMaster.length > 80) {
    fields.master = 'Укажите корректное имя специалиста';
  }

  if (channel && !ALLOWED_CHANNELS.has(channel)) {
    fields.channel = 'Выберите удобный способ связи';
  }

  if (rawTelegram && !/^@?[A-Za-z0-9_]{4,32}$/.test(rawTelegram)) {
    fields.telegram = 'Укажите никнейм формата @username';
  }

  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      fields.date = 'Укажите корректную дату визита';
    } else {
      const parsed = new Date(`${date}T12:00:00Z`);
      const todayIso = getNovosibirskTodayIso();
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        fields.date = 'Указана некорректная дата';
      } else if (date < todayIso) {
        fields.date = 'Дата визита не может быть в прошлом';
      }
    }
  }

  if (timeSlot && !ALLOWED_TIME_SLOTS.has(timeSlot)) {
    fields.timeSlot = 'Выберите удобный временной интервал';
  }

  if (!consent) {
    fields.consent = 'Подтвердите согласие на обработку персональных данных';
  }

  return {
    isSpam: false,
    fields,
    data: {
      name,
      phone,
      service,
      master,
      promo,
      consent,
      channel,
      telegram,
      date,
      timeSlot,
    },
  };
}

function generateBookingId() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `ME-${num}`;
}

function formatTelegramMessage(data, bookingId) {
  const lines = [
    `<b>Новая заявка Maison Éclat · ${escapeHtml(bookingId)}</b>`,
    '',
    `<b>Клиент:</b> ${escapeHtml(data.name)}`,
    `<b>Телефон:</b> ${escapeHtml(data.phone)}`,
    `<b>Процедура:</b> ${escapeHtml(data.service)}`,
    `<b>Мастер:</b> ${escapeHtml(data.master)}`,
    `<b>Первый визит (−15%):</b> ${data.promo ? 'Да' : 'Нет'}`,
  ];

  if (data.channel) {
    lines.push(`<b>Способ связи:</b> ${escapeHtml(CHANNEL_LABELS[data.channel] || data.channel)}`);
  }

  if (data.telegram) {
    lines.push(`<b>Telegram:</b> ${escapeHtml(data.telegram)}`);
  }

  if (data.date) {
    const slotSuffix = data.timeSlot ? ` (${escapeHtml(data.timeSlot)})` : '';
    lines.push(`<b>Дата:</b> ${escapeHtml(data.date)}${slotSuffix}`);
  } else if (data.timeSlot) {
    lines.push(`<b>Удобное время:</b> ${escapeHtml(data.timeSlot)}`);
  }

  return lines.join('\n');
}

module.exports = {
  ALLOWED_CHANNELS,
  CHANNEL_LABELS,
  ALLOWED_TIME_SLOTS,
  escapeHtml,
  getNovosibirskTodayIso,
  normalizeTimeSlot,
  validateBookingPayload,
  generateBookingId,
  formatTelegramMessage,
};
