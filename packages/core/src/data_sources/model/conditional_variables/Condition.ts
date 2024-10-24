import DataVariable from '../DataVariable';
import { evaluateVariable, isDataVariable } from '../utils';
import { Expression, LogicGroup } from './DataCondition';
import { LogicalGroupStatement } from './LogicalGroupStatement';
import { Operator } from './operators';
import { GenericOperation, GenericOperator } from './operators/GenericOperator';
import { LogicalOperator } from './operators/LogicalOperator';
import { NumberOperator, NumberOperation } from './operators/NumberOperator';
import { StringOperator, StringOperation } from './operators/StringOperations';

export class Condition {
  private condition: Expression | LogicGroup | boolean;

  constructor(condition: Expression | LogicGroup | boolean) {
    this.condition = condition;
  }

  evaluate(): boolean {
    return this.evaluateCondition(this.condition);
  }

  /**
   * Recursively evaluates conditions and logic groups.
   */
  private evaluateCondition(condition: any): boolean {
    if (typeof condition === 'boolean') return condition;

    if (this.isLogicGroup(condition)) {
      const { logicalOperator, statements } = condition;
      const operator = new LogicalOperator(logicalOperator);
      const logicalGroup = new LogicalGroupStatement(operator, statements);
      return logicalGroup.evaluate();
    }

    if (this.isExpression(condition)) {
      const { left, operator, right } = condition;
      const op = this.getOperator(left, operator);

      const evaluateLeft = evaluateVariable(left);
      const evaluateRight = evaluateVariable(right);

      return op.evaluate(evaluateLeft, evaluateRight);
    }

    throw new Error('Invalid condition type.');
  }

  /**
   * Factory method for creating operators based on the data type.
   */
  private getOperator(left: any, operator: string): Operator {
    if (this.isOperatorInEnum(operator, GenericOperation)) {
      return new GenericOperator(operator as GenericOperation);
    } else if (typeof left === 'number') {
      return new NumberOperator(operator as NumberOperation);
    } else if (typeof left === 'string') {
      return new StringOperator(operator as StringOperation);
    }
    throw new Error(`Unsupported data type: ${typeof left}`);
  }

  /**
   * Extracts all data variables from the condition, including nested ones.
   */
  getDataVariables(): DataVariable[] {
    const variables: DataVariable[] = [];
    this.extractVariables(this.condition, variables);
    return variables;
  }

  /**
   * Recursively extracts variables from expressions or logic groups.
   */
  private extractVariables(condition: boolean | LogicGroup | Expression, variables: DataVariable[]): void {
    if (this.isExpression(condition)) {
      if (isDataVariable(condition.left)) variables.push(condition.left);
      if (isDataVariable(condition.right)) variables.push(condition.right);
    } else if (this.isLogicGroup(condition)) {
      condition.statements.forEach((stmt) => this.extractVariables(stmt, variables));
    }
  }

  /**
   * Checks if a condition is a LogicGroup.
   */
  private isLogicGroup(condition: any): condition is LogicGroup {
    return condition && typeof condition.logicalOperator !== 'undefined' && Array.isArray(condition.statements);
  }

  /**
   * Checks if a condition is an Expression.
   */
  private isExpression(condition: any): condition is Expression {
    return condition && typeof condition.left !== 'undefined' && typeof condition.operator === 'string';
  }

  /**
   * Checks if an operator exists in a specific enum.
   */
  private isOperatorInEnum(operator: string, enumObject: any): boolean {
    return Object.values(enumObject).includes(operator);
  }
}
