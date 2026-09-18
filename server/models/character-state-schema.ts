export type StateCategory = 'physical' | 'mental' | 'relationship' | 'location' | 'possession' | 'status';
export type StateValueType = 'boolean' | 'number' | 'string';

export interface StateSchemaDefinition {
  key: string;
  category: StateCategory;
  valueType: StateValueType;
  nullable: boolean; // whether it can be nullified explicitly
  isTemporary: boolean;
  
  // Validation constraints
  min?: number;
  max?: number;
  maxLength?: number;
}

export const CHARACTER_STATE_SCHEMA: Record<string, StateSchemaDefinition> = {
  health_status: { key: 'health_status', category: 'physical', valueType: 'string', nullable: true, isTemporary: true, maxLength: 50 },
  injured: { key: 'injured', category: 'physical', valueType: 'boolean', nullable: true, isTemporary: true },
  alive: { key: 'alive', category: 'physical', valueType: 'boolean', nullable: false, isTemporary: false },
  conscious: { key: 'conscious', category: 'physical', valueType: 'boolean', nullable: true, isTemporary: true },
  location: { key: 'location', category: 'location', valueType: 'string', nullable: true, isTemporary: true, maxLength: 100 },
  trust_player: { key: 'trust_player', category: 'relationship', valueType: 'number', nullable: true, isTemporary: false, min: 0, max: 100 },
  fear_player: { key: 'fear_player', category: 'relationship', valueType: 'number', nullable: true, isTemporary: false, min: 0, max: 100 },
  relationship_status: { key: 'relationship_status', category: 'relationship', valueType: 'string', nullable: true, isTemporary: false, maxLength: 50 },
  has_item: { key: 'has_item', category: 'possession', valueType: 'string', nullable: true, isTemporary: false, maxLength: 100 },
  mood: { key: 'mood', category: 'mental', valueType: 'string', nullable: true, isTemporary: true, maxLength: 50 },
  equipped_weapon: { key: 'equipped_weapon', category: 'possession', valueType: 'string', nullable: true, isTemporary: true, maxLength: 100 },
};

export const ALLOWED_STATE_KEYS = Object.keys(CHARACTER_STATE_SCHEMA);

export function validateAndNormalizeStateValue(key: string, value: any): { isValid: boolean, normalizedValue?: string, error?: string } {
  if (value === null) {
    if (CHARACTER_STATE_SCHEMA[key]?.nullable) {
      return { isValid: true, normalizedValue: undefined }; // signifies null
    }
    return { isValid: false, error: 'State key cannot be nullified' };
  }
  
  const schema = CHARACTER_STATE_SCHEMA[key];
  if (!schema) {
    return { isValid: false, error: 'Unknown state key' };
  }

  const strValue = String(value).trim();

  if (schema.valueType === 'boolean') {
    if (strValue.toLowerCase() === 'true') return { isValid: true, normalizedValue: 'true' };
    if (strValue.toLowerCase() === 'false') return { isValid: true, normalizedValue: 'false' };
    return { isValid: false, error: 'Invalid boolean value' };
  }

  if (schema.valueType === 'number') {
    const num = Number(strValue);
    if (isNaN(num)) return { isValid: false, error: 'Invalid numeric value' };
    if (schema.min !== undefined && num < schema.min) return { isValid: false, error: `Value below minimum ${schema.min}` };
    if (schema.max !== undefined && num > schema.max) return { isValid: false, error: `Value above maximum ${schema.max}` };
    return { isValid: true, normalizedValue: strValue };
  }

  if (schema.valueType === 'string') {
    if (schema.maxLength !== undefined && strValue.length > schema.maxLength) {
      return { isValid: false, error: `Value exceeds max length of ${schema.maxLength}` };
    }
    return { isValid: true, normalizedValue: strValue };
  }

  return { isValid: false, error: 'Unknown value type' };
}

export function parseTypedStateValue(key: string, value: string | null): boolean | number | string | null {
  if (value === null) return null;
  const schema = CHARACTER_STATE_SCHEMA[key];
  if (schema) {
    if (schema.valueType === 'boolean') {
      return value.toLowerCase() === 'true';
    }
    if (schema.valueType === 'number') {
      const num = Number(value);
      return isNaN(num) ? value : num;
    }
    return value;
  }
  // If not in schema, infer boolean/number if obvious, otherwise string
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  if (value.trim() !== '' && !isNaN(Number(value))) {
    return Number(value);
  }
  return value;
}

