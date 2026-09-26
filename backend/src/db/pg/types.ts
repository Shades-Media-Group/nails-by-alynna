/**
 * The adapter speaks the MongoDB driver's collection API, so it reuses the driver's own
 * TypeScript types. Type-only: `mongodb` is a dev dependency and never reaches the bundle.
 */
export type {
  AnyBulkWriteOperation,
  CountDocumentsOptions,
  DeleteResult,
  Document,
  Filter,
  FindOneAndDeleteOptions,
  FindOneAndUpdateOptions,
  FindOptions,
  Flatten,
  IndexDescription,
  InferIdType,
  InsertManyResult,
  InsertOneResult,
  OptionalUnlessRequiredId,
  Sort,
  UpdateFilter,
  UpdateOptions,
  UpdateResult,
  WithId,
} from 'mongodb';
