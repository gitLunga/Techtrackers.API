using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TechTrackers.Data.Model;

namespace TechTrackers.Service
{
    public interface IUserService
    {
        Task<User?> GetUserByEmail(string email);
        Task ResetPassword(User user, string newPassword);
    }
}
