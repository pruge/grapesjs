import { NumberOperation } from './operators/NumberOperator';
import { StringOperation } from './operators/StringOperations';
import { GenericOperation } from './operators/GenericOperator';
import { Model } from '../../../common';
import { LogicalOperation } from './operators/LogicalOperator';
import DynamicVariableListenerManager from '../DataVariableListenerManager';
import EditorModel from '../../../editor/model/Editor';
import { Condition } from './Condition';
import DataVariable from '../DataVariable';
import { evaluateVariable, isDataVariable } from '../utils';

export const DataConditionType = 'conditional-variable';
export type Expression = {
  left: any;
  operator: GenericOperation | StringOperation | NumberOperation;
  right: any;
};

export type LogicGroup = {
  logicalOperator: LogicalOperation;
  statements: (Expression | LogicGroup | boolean)[];
};

export class DataCondition extends Model {
  private conditionResult: boolean;
  private condition: Condition;
  private em: EditorModel;

  defaults() {
    return {
      type: DataConditionType,
      condition: false,
    };
  }

  constructor(
    condition: Expression | LogicGroup | boolean,
    private ifTrue: any,
    private ifFalse: any,
    opts: { em: EditorModel },
  ) {
    super();
    this.condition = new Condition(condition, { em: opts.em });
    this.em = opts.em;
    this.conditionResult = this.evaluate();
    this.listenToDataVariables();
  }

  evaluate() {
    return this.condition.evaluate();
  }

  getDataValue(): any {
    return this.conditionResult ? evaluateVariable(this.ifTrue, this.em) : evaluateVariable(this.ifFalse, this.em);
  }

  reevaluate(): void {
    this.conditionResult = this.evaluate();
  }

  toJSON() {
    return {
      condition: this.condition,
      ifTrue: this.ifTrue,
      ifFalse: this.ifFalse,
    };
  }

  private listenToDataVariables() {
    if (!this.em) return;

    const dataVariables = this.condition.getDataVariables();
    if (isDataVariable(this.ifTrue)) dataVariables.push(this.ifTrue);
    if (isDataVariable(this.ifFalse)) dataVariables.push(this.ifFalse);
    dataVariables.forEach((variable) => {
      const variableInstance = new DataVariable(variable, {});
      new DynamicVariableListenerManager({
        model: this,
        em: this.em!,
        dataVariable: variableInstance,
        updateValueFromDataVariable: this.reevaluate.bind(this),
      });
    });
  }
}
