import { DataConditionType } from './conditional_variables/DataCondition';
import DataVariable, { DataVariableType } from './DataVariable';

export function isDataVariable(variable: any) {
  return variable?.type === DataVariableType;
}

export function isDataCondition(variable: any) {
  return variable?.type === DataConditionType;
}

export function evaluateVariable(variable: any) {
  return isDataVariable(variable) ? new DataVariable(variable, {}).getDataValue() : variable;
}
