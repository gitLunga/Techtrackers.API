/**
 * src/middleware/authorize.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Role-based access control was, in the old system, a chain of if/else inside
 *   UserController.Login that merely chose a WELCOME MESSAGE:
 *       if (roles.Contains("Admin")) return Ok(new { message = "Welcome Admin" })
 *   Nothing downstream ever checked a role again. Authorisation was decoration.
 *
 * WHAT IT ACHIEVES
 *   `authorize(ROLES.ADMIN, ROLES.HOD)` is declarative route-level RBAC — the
 *   direct equivalent of `[Authorize(Roles = "Admin,HOD")]`. Because it sits in
 *   the route definition, you can read a routes file top to bottom and see
 *   exactly who may call what, without opening a single controller.
 *
 *   `authorizeSelfOr(...)` covers the very common "your own record, or an admin"
 *   rule that would otherwise be copy-pasted into a dozen controllers.
 */
import ApiError from '../utils/ApiError.js';

export const authorize =
  (...allowedRoles) =>
  (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (allowedRoles.length === 0) return next();

    const hasRole = req.user.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) {
      return next(
        ApiError.forbidden(
          `This action requires one of the following roles: ${allowedRoles.join(', ')}`,
        ),
      );
    }
    next();
  };

/**
 * Allows the request when the caller owns the resource (`:paramName` in the URL
 * matches their own id) OR holds one of the privileged roles.
 */
export const authorizeSelfOr =
  (paramName, ...allowedRoles) =>
  (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());

    const targetId = Number(req.params[paramName]);
    if (Number.isInteger(targetId) && targetId === req.user.id) return next();

    const hasRole = req.user.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) return next(ApiError.forbidden('You may only access your own records'));
    next();
  };

export default authorize;
