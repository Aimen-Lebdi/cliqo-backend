/**
 * A reusable class to handle common API query features like filtering,
 * sorting, field limiting, searching, and pagination.
 */
const { normalizeSearchText } = require("./searchNormalize");

class ApiFeatures {
  /**
   * @param {object} mongooseQuery - The Mongoose query object (e.g., Product.find()).
   * @param {object} queryString - The raw query string object from the request (e.g., req.query).
   */
  constructor(mongooseQuery, queryString) {
    this.mongooseQuery = mongooseQuery;
    this.queryString = queryString;
    // You can set default values here or make them configurable
    this.defaultSort = "-createdAt";
    this.defaultPageLimit = 50;
  }

  /**
   * Cleans the query string by removing non-filter related fields.
   * This is a helper function to prepare the query for filtering.
   */
  _cleanQuery() {
    const queryObj = { ...this.queryString };
    const excludedFields = ["page", "sort", "limit", "fields", "keyword"];
    excludedFields.forEach((field) => delete queryObj[field]);
    return queryObj;
  }

  /**
   * Parses the value from the query string to the correct data type (Number, Boolean, etc.).
   * This prevents incorrect filtering for non-string values.
   * @param {string} value - The value from the query string.
   */
  _parseValue(value) {
    if (value === "true") return true;
    if (value === "false") return false;
    // Check if the value is a number (integer or float)
    if (!isNaN(Number(value)) && !isNaN(parseFloat(value))) {
      return Number(value);
    }
    return value; // Return as a string if it's not a number or boolean
  }

  /**
   * Filters the query based on the provided query string.
   * It handles simple key-value pairs and nested operators like price[gte].
   */
  filter() {
    const queryObj = this._cleanQuery();
    const mongoQuery = {};
    // Iterate through all key-value pairs in the cleaned query object
    for (const [key, value] of Object.entries(queryObj)) {
      // Use a regex to check for nested operators like "price[gte]"
      const match = key.match(/(\w+)\[(gte|gt|lte|lt)\]/);

      if (match) {
        // If a nested operator is found, build a nested MongoDB query object
        const field = match[1]; // e.g., "price"
        const operator = `$${match[2]}`; // e.g., "$gte"
        const parsedValue = this._parseValue(value);

        // Ensure the nested object exists to handle multiple operators for one field
        if (!mongoQuery[field]) {
          mongoQuery[field] = {};
        }
        mongoQuery[field][operator] = parsedValue;
      } else {
        // If no nested operator, treat it as a simple equality filter
        mongoQuery[key] = this._parseValue(value);
      }
    }

    this.mongooseQuery = this.mongooseQuery.find(mongoQuery);
    return this;
  }

  /**
   * Sorts the query results.
   * @param {string} [defaultSort] - A configurable default sort string (e.g., "-createdAt").
   */
  sort(defaultSort = this.defaultSort) {
    if (this.queryString.sort) {
      // Replaces commas with spaces for Mongoose's sort method
      const sortBy = this.queryString.sort.split(",").join(" ");
      this.mongooseQuery = this.mongooseQuery.sort(sortBy);
    } else {
      this.mongooseQuery = this.mongooseQuery.sort(defaultSort);
    }
    return this;
  }

  /**
   * Limits the fields returned in the query.
   * By default, it excludes the '__v' field.
   */
  limitFields() {
    if (this.queryString.fields) {
      // Replaces commas with spaces for Mongoose's select method
      const fields = this.queryString.fields.split(",").join(" ");
      this.mongooseQuery = this.mongooseQuery.select(fields);
    } else {
      // Exclude the version key '__v' by default
      this.mongooseQuery = this.mongooseQuery.select("-__v");
    }
    return this;
  }

  /**
   * Performs a case-insensitive search across specified fields.
   * This is now generic and reusable for any model.
   * @param {string[]} searchFields - An array of fields to search (e.g., ["name", "description"]).
   */
  search(searchFields, options = {}) {
    if (this.queryString.keyword && Array.isArray(searchFields)) {
      let keyword = this.queryString.keyword;

      // Normalize the keyword only when the target fields are themselves
      // normalized (e.g., Product.searchName / searchDescription). Both sides
      // must use identical normalization — normalizing here while the stored
      // field is raw would regress accented/Arabic searches on other models
      // (brand/category/user names).
      if (options.normalizeKeyword) {
        keyword = normalizeSearchText(keyword);
        // Nothing meaningful left after normalization (e.g. only diacritics
        // or whitespace) → don't apply any search filter.
        if (!keyword) return this;
      }

      // Map the search fields to a list of MongoDB conditions
      const searchConditions = searchFields.map((field) => ({
        [field]: { $regex: keyword, $options: "i" },
      }));
      // Use the $or operator to search across multiple fields
      const query = { $or: searchConditions };

      this.mongooseQuery = this.mongooseQuery.find(query);
    }
    return this;
  }

  /**
   * Paginates the query results.
   * NOTE: This method requires the total number of documents to be passed in.
   * @param {number} documentsCounts - The total count of documents for the pagination calculation.
   * @param {number} [defaultLimit] - A configurable default limit for pages.
   */
  paginate(documentsCounts, defaultLimit = this.defaultPageLimit) {
    const page = this.queryString.page * 1 || 1;
    const limit = this.queryString.limit * 1 || defaultLimit;
    const skip = (page - 1) * limit;

    const pagination = {};
    const lastIndex = page * limit;

    // Check if there is a next page
    if (lastIndex < documentsCounts) {
      pagination.nextPage = page + 1;
    }
    // Check if there is a previous page
    if (skip > 0) {
      pagination.previousPage = page - 1;
    }

    pagination.currentPage = page;
    pagination.limit = limit;
    pagination.numberOfPages = Math.ceil(documentsCounts / limit);

    this.mongooseQuery = this.mongooseQuery.skip(skip).limit(limit);
    this.pagination = pagination; // Store the pagination object for easy access
    return this;
  }
}

module.exports = ApiFeatures;
