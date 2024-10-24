import { LogicalOperator } from './operators/LogicalOperator';
import { Expression, LogicGroup } from './DataCondition';
import { Condition } from './Condition';

export class LogicalGroupStatement {
  constructor(
    private operator: LogicalOperator,
    private statements: (Expression | LogicGroup | boolean)[],
  ) {}

  evaluate(): boolean {
    const results = this.statements.map((statement) => {
      const condition = new Condition(statement);
      return condition.evaluate();
    });
    return this.operator.evaluate(results);
  }
}
