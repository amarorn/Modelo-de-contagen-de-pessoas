"""
analytics — persistent event storage, aggregation, and trajectory tracking.

Public surface:
  AggregatorWorker  — background thread; call .start() then .submit(event)
  bp                — Flask Blueprint; register with app.register_blueprint(bp)
"""

from analytics.aggregator import AggregatorWorker
from analytics.api import bp

__all__ = ["AggregatorWorker", "bp"]
